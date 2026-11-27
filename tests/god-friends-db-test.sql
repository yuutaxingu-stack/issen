-- 神様と全員がフレンドになることを手元の PostgreSQL で確かめる（tests/god-friends-db-test.sh から実行）
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, m text) returns text language plpgsql as $$
begin if not c then raise exception 'NG %', m; end if; return 'OK ' || m; end $$;
create function pg_temp.fr(x uuid, y uuid) returns text language sql as $$
  select coalesce((select status from public.friendships where a = least(x, y) and b = greatest(x, y)), 'none') $$;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"kami","name":"神様"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}');
-- 乙は神様へ申請中だった
insert into public.friendships values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'pending');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333') = 'none', '神様を決める前はフレンドでない');

insert into public.god_accounts (id) values ('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') = 'accepted', '申請中だった人も承認になる');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333') = 'accepted', '今いる人は神様とフレンド');

insert into auth.users values ('44444444-4444-4444-4444-444444444444', '{"login":"ddd","name":"丁"}');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444') = 'accepted', '新しく登録した人も神様とフレンド');
select pg_temp.ok(pg_temp.fr('22222222-2222-2222-2222-222222222222', '44444444-4444-4444-4444-444444444444') = 'none', 'ほかの人どうしはフレンドにならない');

\echo '--- 番付に神様は出ない'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.friend_ranking() -> 'rows') r where r ->> 'name' = '神様'), '乙の番付に神様がいない');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok(jsonb_array_length(public.friend_ranking() -> 'rows') = 4, '神様の番付には全員（自分を含め4人）');

\echo '--- 乙が神様を外す → もう一度実行しても戻らない → コードで申請するとすぐ戻る'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.remove_friend('11111111-1111-1111-1111-111111111111');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') = 'none', '外せる');
\i supabase/schema.sql
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') = 'none', 'もう一度実行しても戻さない');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333') = 'accepted', 'ほかの人はそのまま');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(public.send_friend_request((select code from public.profiles where login = 'kami')) = 'accepted', '神様への申請はすぐ承認');
select pg_temp.ok(pg_temp.fr('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222') = 'accepted', 'フレンドに戻る');
select pg_temp.ok(not exists (select 1 from public.god_friend_optout), '外した記録も消える');

\echo '--- フレンド100人の上限に神様は数えない'
insert into auth.users select gen_random_uuid(), jsonb_build_object('login', 'xx' || i, 'name', 'xx' || i) from generate_series(1, 100) i;
insert into public.friendships (a, b, requester, status)
  select least(p.id, '22222222-2222-2222-2222-222222222222'::uuid), greatest(p.id, '22222222-2222-2222-2222-222222222222'::uuid), p.id, 'accepted'
  from public.profiles p where p.login ~ '^xx[0-9]' and p.login <> 'xx100';
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok(public.send_friend_request((select code from public.profiles where login = 'xx100')) = 'sent', '99人＋神様なら申請できる');
select pg_temp.ok(public.send_friend_request((select code from public.profiles where login = 'ccc')) = 'sent', 'まだ申請できる（承認済みは99人）');
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok((select count(*) from public.friendships where '11111111-1111-1111-1111-111111111111' in (a, b) and status = 'accepted') = 103, '神様は103人とフレンド（上限なし）');
