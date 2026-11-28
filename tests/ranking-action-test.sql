-- 一閃と新・一閃の番付が別々になっているかを確かめる（tests/ranking-db-test.sh から、新しい ranking.sql の後に実行）
\set ON_ERROR_STOP 1
create function pg_temp.play(p0 uuid, p1 uuid, s0 int, s1 int, g text) returns text language plpgsql as $$
declare mid uuid; r text; rep jsonb := jsonb_build_object('h', '[]'::jsonb, 's', jsonb_build_array(s0, s1));
begin
  insert into public.matches (p0, p1, seed, game) values (p0, p1, 1, g) returning id into mid;
  perform set_config('request.jwt.claim.sub', p0::text, true);
  perform public.report_result(mid, rep);
  perform set_config('request.jwt.claim.sub', p1::text, true);
  r := public.report_result(mid, rep);
  return g || ' ' || r || ' ' || coalesce(public.match_rating(mid)::text, '-');
end $$;
\echo '--- 新・一閃で甲が乙に勝つ（一閃の戦闘力とは別に 1000 から）'
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 0, 'action');
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 1, 'action');
\echo '--- 一閃の甲と乙は今日すでに5戦数えたが、新・一閃の回数は別'
do $$ begin
  if (select count(*) from public.rating_log where game = 'action' and counted) <> 4 then raise exception 'NG 新・一閃が数えられていない'; end if;
  raise notice 'OK 新・一閃は一閃の1日の回数と別に数える';
end $$;
\echo '--- 一閃でもう一戦（数えない＝今日5戦済み）'
select pg_temp.play('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 2, 0, 'issen');
select 'ratings', p.name, r.game, r.rating, r.wins, r.losses, r.streak from public.ratings r join public.profiles p using (id) order by r.game, p.name;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'record_action_cpu_best', public.record_action_cpu_best(4), public.record_action_cpu_best(2);
\echo '--- 甲から見た一閃の番付'
select r->>'name', r->>'rating', r->>'cpu' from jsonb_array_elements(public.friend_ranking('issen') -> 'rows') r;
select r->>'name', r->>'rating', r->>'cpu' from jsonb_array_elements(public.friend_ranking() -> 'rows') r;
\echo '--- 甲から見た新・一閃の番付'
select r->>'name', r->>'rating', r->>'cpu', r->>'wins', r->>'losses' from jsonb_array_elements(public.friend_ranking('action') -> 'rows') r;
do $$ begin perform public.friend_ranking('x'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 知らない遊び方は断る: %', sqlerrm; end $$;
reset role;
