-- =====================================================================
--  一閃: 古いSupabase（アメリカ）から新しいSupabase（東京）へ、データを丸ごと写す
--  新しいプロジェクトの SQL Editor で実行する（先に schema / save-data / ranking / chat / team を実行しておく）。
--  利用者（ログインIDとパスワード）、名前、フレンド、銭・刀・戦績、戦闘力、団体戦、寄合をそのまま写す。
--  何度実行してもよい: 新しい側を空にしてから、古い側の今の中身を写し直す。
--  二重波かっこの所は、手順ページが古いプロジェクトの接続先で置き換える。
-- =====================================================================

create extension if not exists postgres_fdw;

drop server if exists issen_old cascade;
create server issen_old foreign data wrapper postgres_fdw
  options (host '{{HOST}}', port '{{PORT}}', dbname '{{DB}}', sslmode 'require');
create user mapping for current_user server issen_old
  options (user '{{USER}}', password '{{PASS}}');

drop schema if exists issen_old_public cascade;
drop schema if exists issen_old_auth cascade;
create schema issen_old_public;
create schema issen_old_auth;
import foreign schema public from server issen_old into issen_old_public;
import foreign schema auth limit to (users, identities) from server issen_old into issen_old_auth;

do $move$
declare
  -- 参照される側から順に（ここに無い表は最後に足す）
  pref text[] := array['app_config','katana_catalog','gacha_tiers','finish_coins','rating_config','chat_config',
    'profiles','saves','friendships','team_rooms','team_room_pass','team_members','team_lineups','team_invites',
    'matches','invites','ratings','rating_log','chat_messages','chat_mutes'];
  tabs text[] := '{}';
  t text; cols text; n bigint; replica boolean := true; r record; msg text := '';
begin
  -- 写す表: 新旧の両方にある public の表
  foreach t in array pref loop
    if to_regclass('public.' || quote_ident(t)) is not null and to_regclass('issen_old_public.' || quote_ident(t)) is not null then
      tabs := tabs || t; end if;
  end loop;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' and not (c.relname = any(pref))
             and to_regclass('issen_old_public.' || quote_ident(c.relname)) is not null order by 1 loop
    tabs := tabs || r.relname::text;
  end loop;

  -- 古い側に届くか（ここで失敗したら、新しい側は何も変わらない）
  execute 'select count(*) from issen_old_auth.users' into n;
  if n = 0 then raise exception '古いプロジェクトに利用者が見つかりません。接続先が合っているか確かめてください'; end if;

  -- 新しい側を空にする
  execute 'truncate ' || (select string_agg('public.' || quote_ident(x), ', ') from unnest(tabs) x) || ' cascade';
  delete from auth.users;

  -- 写している間は、自動で動く処理（利用者を作ったときの名前づくり、寄合の知らせ等）を止める
  begin
    perform set_config('session_replication_role', 'replica', true);
  exception when others then
    replica := false;
    foreach t in array tabs loop execute format('alter table public.%I disable trigger user', t); end loop;
  end;

  -- 利用者（パスワードはそのまま。ログインし直せば同じIDとパスワードで入れる）
  foreach t in array array['users','identities'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'auth' and c.table_name = t and c.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns o where o.table_schema = 'issen_old_auth' and o.table_name = t and o.column_name = c.column_name);
    execute format('insert into auth.%I (%s) overriding system value select %s from issen_old_auth.%I', t, cols, cols, t);
    get diagnostics n = row_count; msg := msg || 'auth.' || t || ' ' || n || '件 ';
  end loop;
  if not replica then delete from public.profiles; end if;   -- 利用者を入れたときに自動で作られた分

  -- ゲームのデータ
  foreach t in array tabs loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER'
       and exists (select 1 from information_schema.columns o where o.table_schema = 'issen_old_public' and o.table_name = t and o.column_name = c.column_name);
    execute format('insert into public.%I (%s) overriding system value select %s from issen_old_public.%I', t, cols, cols, t);
    get diagnostics n = row_count; msg := msg || t || ' ' || n || '件 ';
  end loop;

  if replica then perform set_config('session_replication_role', 'origin', true);
  else foreach t in array tabs loop execute format('alter table public.%I enable trigger user', t); end loop; end if;

  -- 自動で増える番号を、写した分の続きから
  for r in select c.table_name, c.column_name from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = any(tabs)
             and pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name) is not null loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
                   'public.' || quote_ident(r.table_name), r.column_name, r.column_name, r.table_name);
  end loop;

  raise notice '写しました: %', msg;
end
$move$;

-- 古いプロジェクトへの接続（パスワード入り）を消す
drop schema if exists issen_old_public cascade;
drop schema if exists issen_old_auth cascade;
drop server if exists issen_old cascade;

-- 結果（数が古いプロジェクトと同じなら成功）
select '利用者' as "写したもの", count(*) as "数" from auth.users
union all select 'プロフィール', count(*) from public.profiles
union all select 'フレンド', count(*) from public.friendships
union all select '持ち物（銭・刀）', count(*) from public.saves
union all select '戦闘力', count(*) from public.ratings
union all select '対戦の記録', count(*) from public.matches
union all select '寄合の発言', count(*) from public.chat_messages;
