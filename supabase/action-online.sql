-- =====================================================================
-- 一閃 新・一閃のオンライン対戦（2026-11-26）
-- 招待と試合に「どちらの一閃か」（game: 'issen' = 今までの一閃 / 'action' = 新・一閃）を持たせる。
-- schema.sql のあとに実行する。何度実行しても大丈夫（今ある試合や招待は 'issen' のまま）。
-- 試合の通信路（match:<id>）・結果の報告（report_result）・戦闘力（ranking.sql）はそのまま使う。
-- =====================================================================
alter table public.invites add column if not exists game text not null default 'issen';
alter table public.matches add column if not exists game text not null default 'issen';
alter table public.invites drop constraint if exists invites_game_check;
alter table public.invites add constraint invites_game_check check (game in ('issen', 'action'));
alter table public.matches drop constraint if exists matches_game_check;
alter table public.matches add constraint matches_game_check check (game in ('issen', 'action'));

-- 招待を送る（p_game を省けば今までの一閃）
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

-- 招待に答える。承認したら、招待と同じ遊び方の試合を作る
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

revoke execute on function public.send_invite(uuid, text), public.respond_invite(uuid, boolean) from public, anon;
grant execute on function public.send_invite(uuid, text), public.respond_invite(uuid, boolean) to authenticated;
