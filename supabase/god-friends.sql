-- 一閃: 神様（運営アカウント）と全員をフレンドにする（2026-11-27）
-- Supabase の SQL Editor に全部貼り付けて Run。何度実行しても大丈夫です。
-- 中身は supabase/schema.sql と supabase/ranking.sql の該当部分と同じです。
--   * 今いる人も、これから登録する人も、神様と自動でフレンド
--   * 神様はフレンド100人の上限に数えない。神様への申請はすぐ承認
--   * 神様を自分で外した人は、もう一度実行しても戻さない（コードで申請すればすぐ戻る）
--   * 番付に神様は出ない

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

-- 自分とフレンドの番付。三つの番付に使う値をまとめて返す
create or replace function public.friend_ranking() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  st int;
  total int;
  rows jsonb;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select c.start_rating into st from public.rating_config c where c.id = 1;
  select count(*) into total from public.katana_catalog;
  with people as (
    select me as id
    union
    select case when f.a = me then f.b else f.a end from public.friendships f
      where (f.a = me or f.b = me) and f.status = 'accepted'
        and not exists (select 1 from public.god_accounts g where g.id = case when f.a = me then f.b else f.a end)   -- 神様は番付に出さない
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', pr.name,
      'me', p.id = me,
      'cpu', coalesce(s.cpu_best, 0),
      'katana', 1 + coalesce((select count(*) from jsonb_each(s.owned) o
                               join public.katana_catalog c on c.id = o.key
                               where o.key <> 'mumei' and jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0), 0),
      'rating', coalesce(r.rating, st),
      'peak', coalesce(r.peak, st),
      'wins', coalesce(r.wins, 0),
      'losses', coalesce(r.losses, 0),
      'streak', coalesce(r.streak, 0),
      'best_streak', coalesce(r.best_streak, 0)
    )), '[]') into rows
  from people p
  join public.profiles pr on pr.id = p.id
  left join public.saves s on s.id = p.id
  left join public.ratings r on r.id = p.id;
  return jsonb_build_object('total', total, 'rows', rows);
end;
$$;

