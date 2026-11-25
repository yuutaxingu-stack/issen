-- ranking.sql を手元の PostgreSQL で確かめる（tests/ranking-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}'),
  ('44444444-4444-4444-4444-444444444444', '{"login":"ddd","name":"丁"}');
insert into public.friendships (a, b, requester, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'accepted'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'accepted'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'pending');
insert into public.saves (id, cpu_best, owned) values
  ('11111111-1111-1111-1111-111111111111', 7, '{"mumei":1,"ruri":2,"nichirin":1,"fake":3,"seiran":0}'),
  ('22222222-2222-2222-2222-222222222222', 12, '{"mumei":1}');

-- 試合を作って、二人が同じ結果を報告する（甲=p0、乙=p1）
create function pg_temp.play(p0 uuid, p1 uuid, s0 int, s1 int) returns text language plpgsql as $$
declare mid uuid; r text; rep jsonb := jsonb_build_object('h', '[]'::jsonb, 's', jsonb_build_array(s0, s1));
begin
  insert into public.matches (p0, p1, seed) values (p0, p1, 1) returning id into mid;
  perform set_config('request.jwt.claim.sub', p0::text, true);
  perform public.report_result(mid, rep);
  perform set_config('request.jwt.claim.sub', p1::text, true);
  r := public.report_result(mid, rep);
  return mid::text || ' ' || r || ' ' || coalesce(public.match_rating(mid)::text, '-');
end $$;

\echo '--- 同じくらいの相手に勝つと +16、連勝で増え幅が上がる'
select pg_temp.play('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 2, 0);
select pg_temp.play('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 1, 2);
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 1);
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 1);
\echo '--- 格下（乙）が格上（甲）に勝つと大きく増え、甲は大きく減り連勝が切れる'
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 0, 2);
\echo '--- 甲と乙は今日すでに3戦。あと2戦まで数え、それより後は数えない'
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 0);
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 0);
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 0);
\echo '--- 結果が食い違った試合は数えない'
do $$ declare mid uuid; begin
  insert into public.matches (p0, p1, seed) values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 1) returning id into mid;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform public.report_result(mid, '{"s":[2,0]}');
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  if public.report_result(mid, '{"s":[0,2]}') <> 'void' then raise exception 'NG'; end if;
  if exists (select 1 from public.rating_log where match_id = mid) then raise exception 'NG 無効試合が数えられた'; end if;
  raise notice 'OK 無効試合は数えない';
end $$;
select 'ratings', p.name, r.rating, r.peak, r.wins, r.losses, r.streak, r.best_streak from public.ratings r join public.profiles p using (id) order by p.name;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin perform * from public.ratings; raise exception 'NG: 直接読めてしまった'; exception when insufficient_privilege then raise notice 'OK ratings は直接読めない'; end $$;
do $$ begin update public.ratings set rating = 9999; raise exception 'NG'; exception when insufficient_privilege then raise notice 'OK ratings は書き換えられない'; end $$;
\echo '--- 甲から見た番付（申請中の丁は出ない。刀は無銘＋るり＋日輪 = 3）'
select jsonb_pretty(public.friend_ranking());
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
\echo '--- 丁から見た番付（自分だけ）'
select public.friend_ranking() -> 'rows';
reset role;
