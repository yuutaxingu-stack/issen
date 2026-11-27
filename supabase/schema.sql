-- =====================================================================
-- 一閃 オンライン機能のデータベース設定
-- Supabase の「SQL Editor」にこのファイルの中身をすべて貼り付けて「Run」を押してください。
-- 何度実行しても大丈夫なように書いてあります（作り直しではなく、足りない物だけ作ります）。
--
-- 守りの考え方:
--   * どの表も RLS（行ごとの守り）を有効にし、自分に関係する行しか読めない
--   * 書き込みは、下の「処理（関数）」を通してだけ行える。表を直接書き換えることはできない
--   * 処理は、フレンドか・試合中でないか・期限内か などをサーバー側で確かめる
-- =====================================================================

-- ---------- 設定（あとから表の画面で変えられる） ----------
create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  invites_paused boolean not null default false,   -- true にすると新しい招待を止める（無料枠が心配なとき）
  invite_seconds int not null default 60,          -- 招待の有効期限（秒）
  message_budget int not null default 2000000,     -- Realtime の月の無料枠（メッセージ数）
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

-- ---------- 利用者 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique check (login ~ '^[a-z0-9_]{3,16}$'),       -- ログインID（英小文字・数字・_）
  name text not null check (char_length(name) between 1 and 10),        -- 表示名（日本語も可）
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),             -- フレンドコード（検索用の固有ID）
  created_at timestamptz not null default now()
);

-- ---------- フレンド ----------
-- 二人の組は a < b の順で1行だけ持つ
create table if not exists public.friendships (
  a uuid not null references public.profiles(id) on delete cascade,
  b uuid not null references public.profiles(id) on delete cascade,
  requester uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (a, b),
  check (a < b),
  check (requester = a or requester = b)
);
create index if not exists friendships_b on public.friendships (b);

-- ---------- 対戦 ----------
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  p0 uuid not null references public.profiles(id) on delete cascade,   -- 招待した側（朱）
  p1 uuid not null references public.profiles(id) on delete cascade,   -- 招待された側（藍）
  seed int not null,
  status text not null default 'playing' check (status in ('playing', 'done', 'void', 'abandoned')),
  report0 jsonb,
  report1 jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists matches_p0 on public.matches (p0, status);
create index if not exists matches_p1 on public.matches (p1, status);
create index if not exists matches_created on public.matches (created_at);

-- ---------- 招待 ----------
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  match_id uuid references public.matches(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists invites_to on public.invites (to_id, status);
create index if not exists invites_from on public.invites (from_id, created_at);
-- どちらの一閃か（'issen' = 今までの一閃 / 'action' = 新・一閃。2026-11-26）
alter table public.invites add column if not exists game text not null default 'issen';
alter table public.matches add column if not exists game text not null default 'issen';
alter table public.invites drop constraint if exists invites_game_check;
alter table public.invites add constraint invites_game_check check (game in ('issen', 'action'));
alter table public.matches drop constraint if exists matches_game_check;
alter table public.matches add constraint matches_game_check check (game in ('issen', 'action'));


-- ---------- 行ごとの守り（RLS） ----------
alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.matches enable row level security;
alter table public.invites enable row level security;

-- 表を直接さわる権限はいったんすべて外し、読み取りだけを必要な分渡す
revoke all on public.app_config, public.profiles, public.friendships, public.matches, public.invites from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.friendships, public.matches, public.invites to authenticated;

-- 二人が「フレンド（または申請中）」かどうか
create or replace function public.is_linked(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.a = least(x, y) and f.b = greatest(x, y));
$$;

drop policy if exists "profiles: 自分とフレンド" on public.profiles;
create policy "profiles: 自分とフレンド" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_linked(id, auth.uid()));

drop policy if exists "friendships: 当事者だけ" on public.friendships;
create policy "friendships: 当事者だけ" on public.friendships for select to authenticated
  using (auth.uid() in (a, b));

drop policy if exists "matches: 当事者だけ" on public.matches;
create policy "matches: 当事者だけ" on public.matches for select to authenticated
  using (auth.uid() in (p0, p1));

drop policy if exists "invites: 当事者だけ" on public.invites;
create policy "invites: 当事者だけ" on public.invites for select to authenticated
  using (auth.uid() in (from_id, to_id));

-- ---------- 登録したら利用者の行を作る ----------
-- 登録時に options.data へ { login, name } を入れて送る
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
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ログインIDが空いているか（登録画面用。誰でも呼べる）
create or replace function public.login_available(p_login text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_login ~ '^[a-z0-9_]{3,16}$' and not exists (select 1 from public.profiles where login = p_login);
$$;

-- 表示名を変える
create or replace function public.set_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  if char_length(trim(p_name)) not between 1 and 10 then raise exception '名前は1〜10文字にしてください'; end if;
  if public.link_blocked(auth.uid(), p_name) then raise exception '名前にリンク（URL）は書き込めません'; end if;
  update public.profiles set name = trim(p_name) where id = auth.uid();
end;
$$;

-- ---------- 神様（運営アカウント）とは全員がフレンド（2026-11-27） ----------
-- god_accounts の本体は save-data.sql。ここでも同じ形で作っておく（どちらを先に実行してもよい）
create table if not exists public.god_accounts (
  id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.god_accounts enable row level security;
revoke all on public.god_accounts from anon, authenticated;
-- 神様とのフレンドを自分で外した人（もう一度実行しても戻さないため）
create table if not exists public.god_friend_optout (
  user_id uuid not null references public.profiles(id) on delete cascade,
  god_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, god_id)
);
alter table public.god_friend_optout enable row level security;
revoke all on public.god_friend_optout from anon, authenticated;

create or replace function public.is_god_acct(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and exists (select 1 from public.god_accounts g where g.id = u);
$$;

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

-- 新しく登録した人は、神様とフレンドになる
create or replace function public.god_friends_on_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.friendships (a, b, requester, status)
  select least(new.id, g.id), greatest(new.id, g.id), g.id, 'accepted'
  from public.god_accounts g where g.id <> new.id
  on conflict (a, b) do update set status = 'accepted';
  return new;
end;
$$;
drop trigger if exists god_friends_on_profile on public.profiles;
create trigger god_friends_on_profile after insert on public.profiles
  for each row execute function public.god_friends_on_profile();

-- 神様を新しく決めたら、その神様は全員とフレンドになる
create or replace function public.god_friends_on_god() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.friendships (a, b, requester, status)
  select least(p.id, new.id), greatest(p.id, new.id), new.id, 'accepted'
  from public.profiles p
  where p.id <> new.id
    and not exists (select 1 from public.god_friend_optout o where o.user_id = p.id and o.god_id = new.id)
  on conflict (a, b) do update set status = 'accepted';
  return new;
end;
$$;
drop trigger if exists god_friends_on_god on public.god_accounts;
create trigger god_friends_on_god after insert on public.god_accounts
  for each row execute function public.god_friends_on_god();

-- 今いる人を神様とフレンドにする（申請中なら承認。自分で外した人はそのまま）
insert into public.friendships (a, b, requester, status)
select least(p.id, g.id), greatest(p.id, g.id), g.id, 'accepted'
from public.profiles p cross join public.god_accounts g
where p.id <> g.id
  and not exists (select 1 from public.god_friend_optout o where o.user_id = p.id and o.god_id = g.id)
on conflict (a, b) do update set status = 'accepted' where public.friendships.status <> 'accepted';
revoke execute on function public.is_god_acct(uuid), public.god_friends_on_profile(), public.god_friends_on_god()
  from public, anon, authenticated;

-- ---------- フレンドの処理 ----------
-- フレンドコードで探す（見つかった相手の名前とコードだけ返す）
create or replace function public.find_by_code(p_code text)
returns table (id uuid, name text, code text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.code from public.profiles p
  where p.code = upper(trim(p_code)) and auth.uid() is not null;
$$;

-- 申請する。相手からすでに申請が来ていれば、そのままフレンドになる
create or replace function public.send_friend_request(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  them uuid;
  f public.friendships;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select id into them from public.profiles where code = upper(trim(p_code));
  if them is null then raise exception 'そのIDの人は見つかりません'; end if;
  if them = me then raise exception '自分にはフレンド申請できません'; end if;
  select * into f from public.friendships where a = least(me, them) and b = greatest(me, them);
  if found then
    if f.status = 'accepted' then return 'already'; end if;
    if f.requester = them then
      update public.friendships set status = 'accepted' where a = f.a and b = f.b;
      return 'accepted';
    end if;
    if not (public.is_god_acct(me) or public.is_god_acct(them)) then return 'pending'; end if;
  end if;
  -- 神様とは申請なしでフレンドになる（外したあとでも、コードで申請すればすぐ戻る）
  if public.is_god_acct(me) or public.is_god_acct(them) then
    delete from public.god_friend_optout where (user_id = me and god_id = them) or (user_id = them and god_id = me);
    insert into public.friendships (a, b, requester, status) values (least(me, them), greatest(me, them), me, 'accepted')
      on conflict (a, b) do update set status = 'accepted';
    return 'accepted';
  end if;
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 30 then
    raise exception '申請中が多すぎます。返事を待ってからにしてください';
  end if;
  if not public.is_god_acct(me) and (select count(*) from public.friendships x where (x.a = me or x.b = me) and x.status = 'accepted'
        and not public.is_god_acct(case when x.a = me then x.b else x.a end)) >= 100 then   -- 神様は数に入れない
    raise exception 'フレンドは100人までです';
  end if;
  insert into public.friendships (a, b, requester, status) values (least(me, them), greatest(me, them), me, 'pending');
  return 'sent';
end;
$$;

-- 届いた申請に答える（承認 true / 拒否 false）
create or replace function public.respond_friend_request(p_other uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'ログインしていません'; end if;
  if p_accept then
    update public.friendships set status = 'accepted'
      where a = least(me, p_other) and b = greatest(me, p_other) and status = 'pending' and requester = p_other;
  else
    delete from public.friendships
      where a = least(me, p_other) and b = greatest(me, p_other) and status = 'pending' and requester = p_other;
  end if;
  if not found then raise exception 'その申請はもうありません'; end if;
end;
$$;

-- フレンドを削除する（自分が出した申請の取り消しにも使う）
create or replace function public.remove_friend(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'ログインしていません'; end if;
  -- 神様とのフレンドを外したら覚えておき、SQLをもう一度実行しても勝手に戻さない
  if public.is_god_acct(p_other) and me <> p_other then
    insert into public.god_friend_optout (user_id, god_id) values (me, p_other) on conflict do nothing;
  elsif public.is_god_acct(me) and me <> p_other then
    insert into public.god_friend_optout (user_id, god_id) values (p_other, me) on conflict do nothing;
  end if;
  delete from public.friendships where a = least(me, p_other) and b = greatest(me, p_other);
  update public.invites set status = 'cancelled'
    where status = 'pending' and ((from_id = me and to_id = p_other) or (from_id = p_other and to_id = me));
end;
$$;

-- ---------- 招待と対戦の処理 ----------
-- 試合中かどうか（30秒以上便りがない試合は終わったものとみなす）
create or replace function public.in_match(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m
    where (m.p0 = u or m.p1 = u) and m.status = 'playing' and m.heartbeat_at > now() - interval '30 seconds');
$$;

drop function if exists public.send_invite(uuid);
create or replace function public.send_invite(p_to uuid, p_game text default 'issen') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cfg public.app_config;
  inv uuid;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  if p_game is null or p_game not in ('issen', 'action') then raise exception 'その遊び方はありません'; end if;
  select * into cfg from public.app_config where id = 1;
  if cfg.invites_paused then raise exception '今はオンライン対戦を休止しています'; end if;
  if not exists (select 1 from public.friendships where a = least(me, p_to) and b = greatest(me, p_to) and status = 'accepted') then
    raise exception 'フレンドにだけ招待できます';
  end if;
  if public.in_match(me) then raise exception 'あなたは試合中です'; end if;
  if public.in_match(p_to) then raise exception '相手は試合中です'; end if;
  if exists (select 1 from public.invites where from_id = me and created_at > now() - interval '5 seconds') then
    raise exception '少し待ってからもう一度招待してください';
  end if;
  update public.invites set status = 'expired' where status = 'pending' and expires_at < now() and (from_id = me or to_id = me);
  update public.invites set status = 'cancelled' where status = 'pending' and from_id = me;
  insert into public.invites (from_id, to_id, expires_at, game)
    values (me, p_to, now() + make_interval(secs => cfg.invite_seconds), p_game)
    returning id into inv;
  return inv;
end;
$$;

create or replace function public.cancel_invite(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.invites set status = 'cancelled' where id = p_id and from_id = auth.uid() and status = 'pending';
end;
$$;

-- 招待に答える。承認したら二人専用の対戦を作り、その id を返す
create or replace function public.respond_invite(p_id uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  inv public.invites;
  mid uuid;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select * into inv from public.invites where id = p_id and to_id = me for update;
  if not found or inv.status <> 'pending' then raise exception 'この招待はもう使えません'; end if;
  if inv.expires_at < now() then
    update public.invites set status = 'expired' where id = p_id;
    raise exception '招待の期限が切れています';
  end if;
  if not p_accept then
    update public.invites set status = 'declined' where id = p_id;
    return null;
  end if;
  if public.in_match(me) or public.in_match(inv.from_id) then raise exception 'どちらかが試合中です'; end if;
  insert into public.matches (p0, p1, seed, game) values (inv.from_id, me, floor(random() * 2147483647)::int, coalesce(inv.game, 'issen'))
    returning id into mid;
  update public.invites set status = 'accepted', match_id = mid where id = p_id;
  update public.invites set status = 'cancelled'
    where status = 'pending' and id <> p_id and (to_id in (me, inv.from_id) or from_id in (me, inv.from_id));
  return mid;
end;
$$;

-- 試合中の便り（20秒ごとに送る。途切れると「試合中」ではなくなる）
create or replace function public.match_heartbeat(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.matches set heartbeat_at = now()
  where id = p_id and status = 'playing' and auth.uid() in (p0, p1);
$$;

-- 結果を報告する。二人の報告が一致したら確定、食い違えば無効試合
create or replace function public.report_result(p_id uuid, p_report jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.matches;
begin
  select * into m from public.matches where id = p_id and me in (p0, p1) for update;
  if not found then raise exception 'その試合はありません'; end if;
  if m.status <> 'playing' then return m.status; end if;
  if pg_column_size(p_report) > 4000 then raise exception '報告が大きすぎます'; end if;
  if me = m.p0 then m.report0 := p_report; else m.report1 := p_report; end if;
  if m.report0 is not null and m.report1 is not null then
    if m.report0 = m.report1 then
      update public.matches set report0 = m.report0, report1 = m.report1, result = m.report0, status = 'done', ended_at = now() where id = p_id;
      return 'done';
    else
      update public.matches set report0 = m.report0, report1 = m.report1, status = 'void', ended_at = now() where id = p_id;
      return 'void';
    end if;
  end if;
  update public.matches set report0 = m.report0, report1 = m.report1, heartbeat_at = now() where id = p_id;
  return 'waiting';
end;
$$;

-- 試合を抜ける（切断・退出）。勝ち負けはつけない
create or replace function public.leave_match(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.matches set status = 'abandoned', ended_at = now()
  where id = p_id and status = 'playing' and auth.uid() in (p0, p1);
$$;

-- ---------- 使用量の見込み（無料枠に気づくため） ----------
-- 1試合あたりのメッセージを約1,000通として、今月の見込みを出す
create or replace function public.usage_estimate()
returns table (matches_this_month bigint, est_messages bigint, budget int, percent numeric, invites_paused boolean)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.matches where created_at >= date_trunc('month', now())),
    (select count(*) from public.matches where created_at >= date_trunc('month', now())) * 1000,
    c.message_budget,
    round((select count(*) from public.matches where created_at >= date_trunc('month', now())) * 1000 * 100.0 / c.message_budget, 1),
    c.invites_paused
  from public.app_config c where c.id = 1;
$$;

-- ---------- 関数を呼べる人 ----------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.login_available(text) to anon, authenticated;
grant execute on function
  public.set_name(text), public.find_by_code(text), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.send_invite(uuid, text), public.cancel_invite(uuid), public.respond_invite(uuid, boolean),
  public.match_heartbeat(uuid), public.report_result(uuid, jsonb), public.leave_match(uuid),
  public.usage_estimate(), public.is_linked(uuid, uuid), public.in_match(uuid)
  to authenticated;

-- ---------- リアルタイムの通知（招待・フレンド申請が届いたら知らせる） ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invites') then
    alter publication supabase_realtime add table public.invites;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    alter publication supabase_realtime add table public.friendships;
  end if;
end $$;

-- ---------- リアルタイムの部屋の守り（非公開チャンネル） ----------
-- lobby: ログインした人だけが入れる「待合」（オンライン状態の表示に使う）
-- user:<自分のid>: 自分あての通知（招待・フレンド申請）だけを受け取る
-- match:<対戦id>: その試合の二人だけが入れる
create or replace function public.can_use_topic(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    t = 'lobby'
    or t = 'user:' || auth.uid()::text
    or (t like 'match:%' and exists (
      select 1 from public.matches m
      where m.id::text = substr(t, 7) and auth.uid() in (m.p0, m.p1) and m.status = 'playing'))
  );
$$;
grant execute on function public.can_use_topic(text) to authenticated;

drop policy if exists "issen: 部屋を読む" on realtime.messages;
create policy "issen: 部屋を読む" on realtime.messages for select to authenticated
  using (public.can_use_topic(realtime.topic()));
drop policy if exists "issen: 部屋に送る" on realtime.messages;
create policy "issen: 部屋に送る" on realtime.messages for insert to authenticated
  with check (public.can_use_topic(realtime.topic()));
