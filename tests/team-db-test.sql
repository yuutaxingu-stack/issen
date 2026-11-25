-- team.sql（団体戦）を手元の PostgreSQL で確かめる（tests/team-db-test.sh から実行）
\set ON_ERROR_STOP 1
set client_min_messages = notice;
-- 部屋を続けて作れない決まりは、ここでは時間を戻してよける
create function pg_temp.older() returns void language sql as $$ update public.team_rooms set created_at = created_at - interval '1 minute' $$;
insert into auth.users
  select ('00000000-0000-0000-0000-00000000000' || i)::uuid, jsonb_build_object('login', 'user' || i, 'name', '人' || i)
  from generate_series(1, 9) i;
-- 1番（ホスト）は 2〜8番とフレンド。9番はだれともフレンドでない
insert into public.friendships (a, b, requester, status)
  select '00000000-0000-0000-0000-000000000001', ('00000000-0000-0000-0000-00000000000' || i)::uuid, '00000000-0000-0000-0000-000000000001', 'accepted'
  from generate_series(2, 8) i;

create function pg_temp.u(i int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-00000000000' || i)::uuid $$;
create function pg_temp.as_(i int) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', pg_temp.u(i)::text, false); end $$;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if not c then raise exception 'NG %', msg; end if; raise notice 'OK %', msg; end $$;
create function pg_temp.err(q text, want text) returns void language plpgsql as $$
begin
  execute q; raise exception 'NG 「%」のはずが通った: %', want, q;
exception when others then
  if sqlerrm like 'NG %' then raise; end if;
  if position(want in sqlerrm) = 0 then raise exception 'NG 「%」のはずが「%」', want, sqlerrm; end if;
  raise notice 'OK 断られた: %', sqlerrm;
end $$;
-- 今の試合を、勝ってほしい人が勝つように二人で報告する
create function pg_temp.play(r uuid, winner uuid) returns text language plpgsql as $$
declare cur jsonb; m public.matches; rep jsonb;
begin
  select state -> 'cur' into cur from public.team_rooms where id = r;
  select * into m from public.matches where id = (cur ->> 'match')::uuid;
  if m.id is null then raise exception 'NG 試合がない %', cur; end if;
  rep := jsonb_build_object('h', '[]'::jsonb, 's', case when winner = m.p0 then '[2,1]'::jsonb else '[0,2]'::jsonb end);
  perform set_config('request.jwt.claim.sub', m.p0::text, false); perform public.report_result(m.id, rep);
  perform set_config('request.jwt.claim.sub', m.p1::text, false); perform public.report_result(m.id, rep);
  return cur ->> 'label';
end $$;
create function pg_temp.st(r uuid) returns jsonb language sql as $$ select state from public.team_rooms where id = r $$;
create function pg_temp.cur_pair(r uuid) returns text language sql as $$
  select (select name from public.profiles where id = (state #>> '{cur,a}')::uuid) || '対' || (select name from public.profiles where id = (state #>> '{cur,b}')::uuid)
  from public.team_rooms where id = r $$;

-- ===================================================================
\echo '=== 大将戦（赤3人・青2人。青は1人が2回出る）'
select pg_temp.as_(1);
create temp table t (k text primary key, r uuid);
insert into t select 'taisho', public.team_create('taisho', 2, 5, null);
grant select on t to authenticated;
select pg_temp.ok((select count(*) from public.team_members where room_id = (select r from t where k = 'taisho')) = 1, 'ホストが赤で部屋に入っている');
select pg_temp.as_(2); select public.team_join((select r from t where k = 'taisho'), null, null);
select pg_temp.as_(3); select public.team_join((select r from t where k = 'taisho'), null, null);
select pg_temp.as_(4); select public.team_join((select r from t where k = 'taisho'), null, null);
select pg_temp.as_(5); select public.team_join((select r from t where k = 'taisho'), null, null);
select pg_temp.as_(9);
select pg_temp.err($$select public.team_join((select r from t where k = 'taisho'), null, null)$$, 'フレンドか招待');
select pg_temp.ok(public.team_join(null, (select code from public.team_rooms where id = (select r from t where k = 'taisho')), null) is not null, '部屋番号ならフレンドでなくても入れる');
select public.team_leave((select r from t where k = 'taisho'));
-- 入った順に 赤青赤青 と分かれる: 1赤 2青 3赤 4青 5赤
select pg_temp.ok(public.team_list((select r from t where k = 'taisho'), 'red') = array[pg_temp.u(1), pg_temp.u(3), pg_temp.u(5)], '赤は1・3・5');
select pg_temp.ok(public.team_list((select r from t where k = 'taisho'), 'blue') = array[pg_temp.u(2), pg_temp.u(4)], '青は2・4');
-- 青の順番を決める（3枠: 4, 2, 4）。赤の人には見えない
select pg_temp.as_(2); select public.team_set_lineup((select r from t where k = 'taisho'), 'blue', array[pg_temp.u(4), pg_temp.u(2), pg_temp.u(4)]);
select pg_temp.err($$select public.team_set_lineup((select r from t where k = 'taisho'), 'red', array[pg_temp.u(1)])$$, '自分のチーム');
set role authenticated; select pg_temp.as_(3);
select pg_temp.ok((select count(*) from public.team_lineups where room_id = (select r from t where k = 'taisho')) = 0, '始まる前は相手の順番が見えない');
select pg_temp.as_(4);
select pg_temp.ok((select count(*) from public.team_lineups where room_id = (select r from t where k = 'taisho')) = 1, '自分のチームの順番は見える');
reset role;
select pg_temp.as_(2); select pg_temp.err($$select public.team_start((select r from t where k = 'taisho'))$$, '部屋の主');
select pg_temp.as_(1); select public.team_start((select r from t where k = 'taisho'));
select pg_temp.ok((select state #>> '{cur,label}' from public.team_rooms where id = (select r from t where k = 'taisho')) = '先鋒', '先鋒戦から');
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'taisho')) = '人1対人4', '先鋒は 赤1 対 青4（決めた順）');
select pg_temp.ok((select room_id from public.matches where id = (pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,match}')::uuid) = (select r from t where k = 'taisho'), '試合に部屋がつく');
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(1));   -- 赤 +1
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'taisho')) = '人3対人2' and pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,label}' = '中堅', '中堅は 赤3 対 青2');
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(2));   -- 青 +1
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'taisho')) = '人5対人4' and (pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,pts}')::int = 2, '大将戦は 赤5 対 青4、勝ち点2');
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(4));   -- 青 +2
select pg_temp.ok((select status from public.team_rooms where id = (select r from t where k = 'taisho')) = 'done'
  and pg_temp.st((select r from t where k = 'taisho')) ->> 'winner' = 'blue'
  and pg_temp.st((select r from t where k = 'taisho')) -> 'score' = '{"red":1,"blue":3}', '青の勝ち（1対3）');
select pg_temp.ok((select count(*) from public.rating_log) = 0, '団体戦の試合は戦闘力に数えない');

\echo '=== 大将戦の引き分け → 代表戦'
select pg_temp.as_(1); select public.team_again((select r from t where k = 'taisho'));
select public.team_start((select r from t where k = 'taisho'));
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(1));   -- 赤 +1
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(3));   -- 赤 +1
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(4));   -- 青 +2 → 2対2
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,label}' = '代表戦' and pg_temp.cur_pair((select r from t where k = 'taisho')) = '人5対人4', '同点なら大将どうしの代表戦');
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(5));
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) ->> 'winner' = 'red', '代表戦に勝った赤の勝ち');

\echo '=== 止まった試合（通信が切れた）→ やり直し・不戦'
select pg_temp.as_(1); select public.team_again((select r from t where k = 'taisho'));
select public.team_start((select r from t where k = 'taisho'));
select pg_temp.as_(4); select public.leave_match((pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,match}')::uuid);
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,st}' = 'stop', '切れたら試合が止まる');
select pg_temp.as_(1); select public.team_redo((select r from t where k = 'taisho'));
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,st}' = 'play' and pg_temp.cur_pair((select r from t where k = 'taisho')) = '人1対人4', 'やり直すと同じ二人で新しい試合');
select public.team_forfeit((select r from t where k = 'taisho'), pg_temp.u(4));
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) #>> '{score,red}' = '1' and pg_temp.st((select r from t where k = 'taisho')) #>> '{cur,label}' = '中堅', '不戦にすると赤に1点、次へ進む');
-- 部屋をぬけた人の番は不戦
select pg_temp.as_(5); select public.team_leave((select r from t where k = 'taisho'));
select pg_temp.play((select r from t where k = 'taisho'), pg_temp.u(2));  -- 中堅 青+1。大将は赤5がいない → 青の不戦勝 +2
select pg_temp.ok(pg_temp.st((select r from t where k = 'taisho')) ->> 'winner' = 'blue' and pg_temp.st((select r from t where k = 'taisho')) #>> '{bouts,2,why}' = '不戦', 'いない人の番は不戦になる');

-- ===================================================================
\echo '=== 勝ち抜き戦（赤2人・青3人）'
select pg_temp.older(); select pg_temp.as_(1); insert into t select 'kachi', public.team_create('kachinuki', 1, 5, 'まつ');
select pg_temp.as_(2); select pg_temp.err($$select public.team_join((select r from t where k = 'kachi'), null, null)$$, '合言葉が必要');
select pg_temp.err($$select public.team_join((select r from t where k = 'kachi'), null, 'うめ')$$, '合言葉が違います');
select public.team_join((select r from t where k = 'kachi'), null, 'まつ');
select pg_temp.as_(1); select public.team_invite((select r from t where k = 'kachi'), pg_temp.u(3));
select pg_temp.as_(3); select pg_temp.ok(public.team_join((select r from t where k = 'kachi'), null, null) is not null, '招待された人は合言葉なしで入れる');
select pg_temp.ok((select count(*) from public.team_members where user_id = pg_temp.u(3)) = 1, '前の部屋からはぬけている');
select pg_temp.as_(4); select public.team_join((select r from t where k = 'kachi'), null, 'まつ');
select pg_temp.as_(5); select public.team_join((select r from t where k = 'kachi'), null, 'まつ');
-- 1赤 2青 3赤 4青 5赤 → 5を青へ
select pg_temp.as_(1); select public.team_set_team((select r from t where k = 'kachi'), pg_temp.u(5), 'blue');
select public.team_start((select r from t where k = 'kachi'));
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'kachi')) = '人1対人2', '1人目どうし');
select pg_temp.play((select r from t where k = 'kachi'), pg_temp.u(1));
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'kachi')) = '人1対人4', '勝った赤1が残り、青の2人目と');
select pg_temp.play((select r from t where k = 'kachi'), pg_temp.u(1));
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'kachi')) = '人1対人5', '青の3人目と');
select pg_temp.play((select r from t where k = 'kachi'), pg_temp.u(1));
select pg_temp.ok(pg_temp.st((select r from t where k = 'kachi')) ->> 'winner' = 'red' and jsonb_array_length(pg_temp.st((select r from t where k = 'kachi')) -> 'bouts') = 3, '赤1が3人抜きで赤の勝ち');

-- ===================================================================
\echo '=== 自由戦（1人 対 3人、3点先取）'
select pg_temp.older(); select pg_temp.as_(1); insert into t select 'free', public.team_create('free', 1, 3, null);
select pg_temp.as_(6); select public.team_join((select r from t where k = 'free'), null, null);
select pg_temp.as_(7); select public.team_join((select r from t where k = 'free'), null, null);
select pg_temp.as_(8); select public.team_join((select r from t where k = 'free'), null, null);
select pg_temp.as_(1);
select public.team_set_team((select r from t where k = 'free'), pg_temp.u(7), 'blue');
select public.team_set_team((select r from t where k = 'free'), pg_temp.u(8), 'blue');
select public.team_start((select r from t where k = 'free'));
select pg_temp.ok(pg_temp.st((select r from t where k = 'free')) -> 'cur' is null, 'だれも挑まなければ待つ');
select pg_temp.as_(7); select public.team_challenge((select r from t where k = 'free'), true);
select pg_temp.as_(6); select public.team_challenge((select r from t where k = 'free'), true);
select pg_temp.ok(pg_temp.st((select r from t where k = 'free')) -> 'cur' is null, '片方のチームだけでは始まらない');
select pg_temp.as_(1); select public.team_challenge((select r from t where k = 'free'), true);
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'free')) = '人1対人7', '赤と青が挑んだら始まる（先に手を挙げた青7）');
select pg_temp.play((select r from t where k = 'free'), pg_temp.u(1));
select pg_temp.ok(pg_temp.cur_pair((select r from t where k = 'free')) = '人1対人6', '勝った赤1が残り、次に挙げていた青6と');
select pg_temp.as_(7); select public.team_challenge((select r from t where k = 'free'), true);
select pg_temp.play((select r from t where k = 'free'), pg_temp.u(6));
select pg_temp.ok(pg_temp.st((select r from t where k = 'free')) #>> '{champ,id}' = pg_temp.u(6)::text and pg_temp.st((select r from t where k = 'free')) -> 'cur' is null, '青6が勝ち残り、赤の挑戦を待つ');
select pg_temp.as_(6); select pg_temp.err($$select public.team_challenge((select r from t where k = 'free'), true)$$, '勝ち残って');
select pg_temp.as_(1); select public.team_challenge((select r from t where k = 'free'), true);
select pg_temp.play((select r from t where k = 'free'), pg_temp.u(6));
select pg_temp.ok(pg_temp.st((select r from t where k = 'free')) -> 'score' = '{"red":1,"blue":2}', '点数 1対2');
select pg_temp.as_(1); select public.team_finish((select r from t where k = 'free'));
select pg_temp.ok(pg_temp.st((select r from t where k = 'free')) ->> 'winner' = 'blue', 'ホストが終わらせると点の多い青の勝ち');

-- ===================================================================
\echo '=== トーナメント（5人。不戦勝あり）'
select pg_temp.older(); select pg_temp.as_(1); insert into t select 'tour', public.team_create('tournament', 1, 5, null);
select pg_temp.as_(2); select public.team_join((select r from t where k = 'tour'), null, null);
select pg_temp.as_(3); select public.team_join((select r from t where k = 'tour'), null, null);
select pg_temp.as_(4); select public.team_join((select r from t where k = 'tour'), null, null);
select pg_temp.as_(5); select public.team_join((select r from t where k = 'tour'), null, null);
select pg_temp.as_(8); select public.team_join((select r from t where k = 'tour'), null, null);
select pg_temp.as_(8); select public.team_set_team((select r from t where k = 'tour'), pg_temp.u(8), 'watch');
select pg_temp.as_(1); select public.team_start((select r from t where k = 'tour'));
select pg_temp.ok(jsonb_array_length(pg_temp.st((select r from t where k = 'tour')) #> '{rounds,0}') = 8, '5人なら8枠');
do $$ declare r uuid := (select r from t where k = 'tour'); i int := 0; a uuid; begin
  while (select status from public.team_rooms where id = r) = 'playing' and i < 10 loop
    a := (pg_temp.st(r) #>> '{cur,a}')::uuid;
    raise notice '% %', pg_temp.st(r) #>> '{cur,label}', pg_temp.cur_pair(r);
    perform pg_temp.play(r, a); i := i + 1;
  end loop;
  perform pg_temp.ok(i = 4, '5人のトーナメントは4試合');
  perform pg_temp.ok(pg_temp.st(r) ->> 'winner' is not null and pg_temp.st(r) #>> '{bouts,3,label}' = '決勝', '決勝のあと優勝が決まる');
  perform pg_temp.ok(not (pg_temp.st(r) -> 'rounds')::text like '%' || pg_temp.u(8)::text || '%', '観戦の人は出ない');
end $$;

\echo '=== 解散'
select pg_temp.as_(2); select pg_temp.err($$select public.team_close((select r from t where k = 'kachi'))$$, '部屋の主');
select pg_temp.as_(1); select public.team_close((select r from t where k = 'kachi'));
select pg_temp.as_(2); select pg_temp.err($$select public.team_join((select r from t where k = 'kachi'), null, 'まつ')$$, '閉じています');
\echo '=== 中の処理はゲームから呼べない'
set role authenticated;
select pg_temp.err($$select public.team_drop((select r from t where k = 'tour'), '00000000-0000-0000-0000-000000000003')$$, 'permission denied');
select pg_temp.err($$select public.team_advance((select r from t where k = 'tour'))$$, 'permission denied');
select pg_temp.err($$select * from public.team_room_pass$$, 'permission denied');
reset role;
