-- save-data.sql の処理を手元の PostgreSQL で確かめる（tests/save-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'), ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'get', public.get_save();
-- 表を直接は読めない
do $$ begin perform * from public.saves; raise exception 'NG: 直接読めてしまった'; exception when insufficient_privilege then raise notice 'OK 直接は読めない'; end $$;
-- 端末の記録を引っ越す（知らない刀・決着名・大きすぎる数・数でない値は捨てる）
select 'import', public.import_local('{"coins":123,"best":4,"owned":{"mumei":1,"ruri":2,"nichirin":1,"fake":5},"rec":{"ruri":{"疾風":3,"うそ":9},"fake":{"疾風":1}},"equip":["ruri","nichirin"]}');
select 'import2', public.import_local('{"coins":"x","owned":{"ruri":1}}');
-- 勝ち
select 'win', public.record_win('明鏡止水', 'ruri');
do $$ begin perform public.record_win('疾風', 'geppaku'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 持っていない刀は断る: %', sqlerrm; end $$;
do $$ begin perform public.record_win('うそ', 'ruri'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 知らない決着は断る: %', sqlerrm; end $$;
select 'best', public.record_cpu_best(2), public.record_cpu_best(9);
-- ガチャ
select 'pull', public.pull_gacha(5);
do $$ begin perform public.pull_gacha(100000); raise exception 'NG'; exception when raise_exception then raise notice 'OK 銭が足りない/回数: %', sqlerrm; end $$;
select 'equip', public.set_equip('mumei', 'ruri');
-- 別の人からは見えない・混ざらない
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'other', public.get_save();
reset role;
-- ガチャの確率（サーバーのくじを1万回）
update public.saves set coins = 1000000 where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
create temp table pulls as select public.pull_gacha(1000) g union all select public.pull_gacha(1000) union all select public.pull_gacha(1000);
reset role;
select 'rates', c.tier, count(*) from pulls, jsonb_array_elements(g->'got') x join public.katana_catalog c on c.id = x->>'id' group by c.tier order by 3 desc;
select 'coins after 3000 pulls', coins, pulls from public.saves where id = '22222222-2222-2222-2222-222222222222';

-- 1分に30回を超える勝ちは断る
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare i int; begin
  for i in 1..29 loop perform public.record_win('疾風', 'mumei'); end loop;
  begin perform public.record_win('疾風', 'mumei'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 速すぎる勝ちは断る: %', sqlerrm; end;
end $$;
reset role;

-- 玉鋼: 持っている刀が出たら玉鋼になり、銭は戻らない
select 'steel after 3000 pulls', steel, coins from public.saves where id = '22222222-2222-2222-2222-222222222222';
do $$ declare s public.saves; begin
  select * into s from public.saves where id = '22222222-2222-2222-2222-222222222222';
  if s.steel <= 0 then raise exception 'NG 玉鋼が増えていない'; end if;
  if s.coins <> 1000000 - 3000 * 10 then raise exception 'NG 重なりで銭が戻った: %', s.coins; end if;
  raise notice 'OK 3000回で玉鋼 %（1回あたり %）、銭は戻らない', s.steel, round(s.steel / 3000.0, 2);
end $$;
-- 鍛える
update public.saves set steel = 1600, owned = '{"mumei":1}' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'forge', public.forge_katana('geppaku') ->> 'steel', public.get_save() -> 'owned' ->> 'geppaku';
do $$ begin perform public.forge_katana('geppaku'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 持っている刀は鍛えない: %', sqlerrm; end $$;
do $$ begin perform public.forge_katana('nichirin'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 玉鋼が足りない: %', sqlerrm; end $$;
do $$ begin perform public.forge_katana('fake'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 知らない刀は鍛えない: %', sqlerrm; end $$;
do $$ begin perform public.forge_katana('mumei'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 無銘は鍛えない: %', sqlerrm; end $$;
select 'forge2', public.forge_katana('yamabuki') ->> 'steel';
do $$ begin update public.saves set steel = 999999; raise exception 'NG 直接書けた'; exception when insufficient_privilege then raise notice 'OK 玉鋼を直接は書けない'; end $$;
-- 引っ越しで玉鋼も足す
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'import steel', public.import_local('{"steel":77}') ->> 'steel';
reset role;
