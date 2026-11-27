-- 一閃: プレイヤーがリンク（URL）を書き込めないようにする（2026-11-27）
-- Supabase の SQL Editor に全部貼り付けて Run。何度実行しても大丈夫です。
-- 中身は supabase/schema.sql・chat.sql・profile.sql の該当部分と同じです。
--   * 寄合（皆で・密書・募集）、名前、名乗りの一言 にリンクを書くと断る
--   * 神様（運営アカウント）は書ける。運営への報告（文箱の「運営へ」）は今まで通り書ける
--   * 今すでに書かれているリンク入りの発言は消し、一言は空に、名前はログインIDに戻す

-- 神様の表（本体は save-data.sql。無ければ作るだけ）
create table if not exists public.god_accounts (
  id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- ---------- リンク（URL）を書かせない（2026-11-27） ----------
-- 寄合・密書・名前・名乗りの一言で使う。画面側の同じ判定は js/no-link.js（ここと揃えること）。
-- 全角も半角に直してから見る。http:/ ://  www.  example.com（よく使う末尾）  example.xx/ を弾く
create or replace function public.has_link(t text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(normalize(coalesce(t, ''), nfkc)) ~
    '(https?|ftp)\s?:\s?/|:\s?//|www\s?\.|[a-z0-9-]+\s?[.。]\s?(com|net|org|info|biz|jp|co|io|me|gg|tv|ly|to|cc|be|us|uk|ru|cn|kr|tw|hk|de|fr|eu|in|ai|so|gl|app|dev|xyz|link|site|online|top|club|shop|page|fun|live|vip|work|blog|store|tech|asia|mobi|pro|world|today|chat|social|moe|tokyo)(?![a-z0-9])|[a-z0-9-]+\.[a-z]{2,}/';
$$;
-- 神様（運営アカウント）は書ける
create or replace function public.link_blocked(u uuid, t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_link(t) and not exists (select 1 from public.god_accounts g where g.id = u);
$$;
revoke execute on function public.link_blocked(uuid, text) from public, anon;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c text;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 見間違えやすい 0 O 1 I は使わない
  i int;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where code = c);
  end loop;
  insert into public.profiles (id, login, name, code)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'login', '')),
    case when public.has_link(new.raw_user_meta_data ->> 'name') then left(lower(new.raw_user_meta_data ->> 'login'), 10)   -- リンク入りの名前はログインIDにする
         else coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), lower(new.raw_user_meta_data ->> 'login')) end,
    c
  );
  return new;
end;
$$;

create or replace function public.set_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  if char_length(trim(p_name)) not between 1 and 10 then raise exception '名前は1〜10文字にしてください'; end if;
  if public.link_blocked(auth.uid(), p_name) then raise exception '名前にリンク（URL）は書き込めません'; end if;
  update public.profiles set name = trim(p_name) where id = auth.uid();
end;
$$;

create or replace function public.chat_post(p_body text, p_mentions uuid[] default '{}', p_to uuid default null, p_kind text default 'say', p_ref jsonb default '{}')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cfg public.chat_config;
  b text := trim(coalesce(p_body, ''));
  ms uuid[];
  r jsonb := '{}';
  nid bigint;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select * into cfg from public.chat_config where id = 1;
  if cfg.paused then raise exception '今はチャットを休止しています'; end if;
  if p_kind not in ('say', 'recruit', 'team') then raise exception 'その種類の発言はできません'; end if;
  if p_kind = 'say' and b = '' then raise exception '何も書かれていません'; end if;
  if char_length(b) > cfg.max_len then raise exception '%文字までにしてください', cfg.max_len; end if;
  if public.link_blocked(me, b) then raise exception 'リンク（URL）は書き込めません'; end if;
  if exists (select 1 from public.chat_messages where author = me and kind in ('say', 'recruit', 'team')
             and created_at > now() - make_interval(secs => cfg.gap_seconds)) then
    raise exception '少し待ってから送ってください';
  end if;
  if p_to is not null then
    if p_kind <> 'say' then raise exception '内緒で送れるのはふつうの発言だけです'; end if;
    if not public.is_friend(me, p_to) then raise exception 'フレンドにだけ送れます'; end if;
  end if;
  -- 名指しはフレンドだけ（重ならないように、最大10人）
  select coalesce(array_agg(distinct x), '{}') into ms
    from unnest(coalesce(p_mentions, '{}')) x where public.is_friend(me, x);
  if p_to is not null then ms := array[p_to]; end if;
  ms := ms[1:10];

  if p_kind = 'recruit' then
    if public.in_match(me) then raise exception '試合中は募集できません'; end if;
    -- 前の募集はしめる
    update public.chat_messages set ref = ref || '{"open": false}'
      where author = me and kind = 'recruit' and (ref ->> 'open')::boolean;
    r := jsonb_build_object('open', true, 'until', now() + make_interval(mins => cfg.recruit_minutes));
  elsif p_kind = 'team' then
    -- 団体戦の募集。部屋の情報は団体戦の処理が入れる（ここでは大きさだけ見る）
    if pg_column_size(p_ref) > 1000 then raise exception '情報が大きすぎます'; end if;
    r := coalesce(p_ref, '{}') || '{"open": true}';
  end if;

  insert into public.chat_messages (author, to_id, kind, body, mentions, ref)
    values (me, p_to, p_kind, b, ms, r) returning id into nid;
  perform public.chat_cleanup();
  return nid;
end;
$$;

create or replace function public.set_profile(p_word text, p_fav text, p_title text, p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); x public.profile_ext; w text; g boolean := public.is_god(auth.uid());   -- 神様は二つ名・背景・刀を全部持っている
begin
  if me is null then raise exception 'ログインしていません'; end if;
  insert into public.profile_ext (id) values (me) on conflict (id) do nothing;
  select * into x from public.profile_ext e where e.id = me for update;
  w := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'));
  if char_length(w) > 30 then raise exception '一言は30文字までです'; end if;
  if public.link_blocked(me, w) then raise exception '一言にリンク（URL）は書き込めません'; end if;
  if p_fav is not null and p_fav <> 'mumei' and not g and not exists (
      select 1 from public.saves s where s.id = me and coalesce((s.owned ->> p_fav)::numeric, 0) > 0) then
    raise exception 'その刀を持っていません';
  end if;
  if p_title is not null and not (g and exists (select 1 from public.title_catalog t where t.id = p_title)) and not (p_title = any(x.titles)) then raise exception 'その二つ名は持っていません'; end if;
  if p_plate is not null and not (g and exists (select 1 from public.plate_catalog p where p.id = p_plate)) and not (p_plate = any(x.plates) or exists (select 1 from public.plate_catalog p where p.id = p_plate and p.free)) then
    raise exception 'その背景は持っていません';
  end if;
  update public.profile_ext set word = w, fav = p_fav, title = p_title, plate = p_plate, updated_at = now() where id = me;
  return public.get_profile(me);
end;
$$;

-- ---------- 今あるリンクを片づける ----------
delete from public.chat_messages m where m.kind in ('say', 'recruit', 'team') and public.link_blocked(m.author, m.body);
update public.profile_ext e set word = '' where public.link_blocked(e.id, e.word);
update public.profiles p set name = left(p.login, 10) where public.link_blocked(p.id, p.name);
