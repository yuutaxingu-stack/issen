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

-- 絶の印: 自分・フレンド・渡した人のうち、絶の刀を持つ人だけ
insert into auth.users values ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}');
update public.saves set owned = owned || '{"ouka":1}' where id = '22222222-2222-2222-2222-222222222222';
insert into public.saves (id, owned) values ('33333333-3333-3333-3333-333333333333', '{"mumei":1,"ouka":2}') on conflict (id) do update set owned = excluded.owned;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare r jsonb; begin
  r := public.zetsu_owners();
  if r <> '[]'::jsonb then raise exception 'NG フレンドでない人が出た: %', r; end if;
  r := public.zetsu_owners(array['22222222-2222-2222-2222-222222222222'::uuid]);
  if r <> '["22222222-2222-2222-2222-222222222222"]'::jsonb then raise exception 'NG 渡した人: %', r; end if;
  raise notice 'OK 絶の印: 渡した人だけ %', r;
end $$;
reset role;
insert into public.friendships values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'accepted');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ declare r jsonb; begin
  r := public.zetsu_owners();
  if r <> '["33333333-3333-3333-3333-333333333333"]'::jsonb then raise exception 'NG フレンド: %', r; end if;
  raise notice 'OK 絶の印: フレンドの持ち主 %', r;
end $$;
reset role;
do $$ begin
  set local role anon;
  perform public.zetsu_owners(); raise exception 'NG';
exception when insufficient_privilege then raise notice 'OK ログインしていないと呼べない'; end $$;
reset role;

-- 箱（2026-11-27）: 第一弾だけのうちは絶0.5%。第二弾が出ると第一弾は0.1%、第二弾は0.3%。箱の刀しか出ない
do $$ declare z numeric; n numeric; begin
  select weight into z from public.box_rates('b1') where tier = '絶';
  select weight into n from public.box_rates('b1') where tier = '並';
  if z <> 0.5 or n <> 59.5 then raise exception 'NG 第一弾の割合 絶% 並%', z, n; end if;
  if public.box_latest() <> 'b1' then raise exception 'NG 最新の箱'; end if;
  raise notice 'OK 第一弾だけのうちは 絶 % ・並 %', z, n;
end $$;
begin;
insert into public.gacha_boxes (id, ord, mei, pick) values ('b2', 2, '第二弾', 'test_z2');
insert into public.katana_catalog (id, tier, box) values ('test_z2', '絶', 'b2'), ('test_n2', '並', 'b2'), ('test_j2', '上', 'b2');
do $$ declare z1 numeric; z2 numeric; n2 numeric; c int; begin
  select weight into z1 from public.box_rates('b1') where tier = '絶';
  select weight into z2 from public.box_rates('b2') where tier = '絶';
  select weight into n2 from public.box_rates('b2') where tier = '並';
  select count(*) into c from public.box_rates('b2');
  if public.box_latest() <> 'b2' or z1 <> 0.1 or z2 <> 0.3 or n2 <> 59.7 or c <> 3 then raise exception 'NG 第二弾の割合 % % % %', z1, z2, n2, c; end if;
  raise notice 'OK 第二弾が出ると 第一弾の絶 % ・第二弾の絶 % ・第二弾の並 %（極・幻のない階級は外れる）', z1, z2, n2;
end $$;
update public.saves set coins = 1000000, owned = '{"mumei":1}' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table p2 as select public.pull_gacha(1000) g union all select public.pull_gacha(1000, null, 'b1');
reset role;
do $$ declare bad int; old int; begin
  select count(*) into bad from (select g from p2 limit 1) a, jsonb_array_elements(g->'got') x join public.katana_catalog c on c.id = x->>'id' where c.box <> 'b2';
  select count(*) into old from (select g from p2 offset 1) a, jsonb_array_elements(g->'got') x join public.katana_catalog c on c.id = x->>'id' where c.box <> 'b1';
  if bad > 0 or old > 0 then raise exception 'NG 箱の外の刀が出た % %', bad, old; end if;
  if (select g->>'box' from p2 limit 1) <> 'b2' then raise exception 'NG 箱を渡さないと最新の箱'; end if;
  raise notice 'OK 箱を渡さなければ最新の第二弾、b1 を渡せば第一弾の刀だけが出る';
end $$;
set role authenticated;
do $$ begin perform public.pull_gacha(1, null, 'nobox'); raise exception 'NG'; exception when raise_exception then raise notice 'OK 知らない箱は断る: %', sqlerrm; end $$;
reset role;
update public.saves set steel = 6000, owned = owned - 'test_z2' where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
do $$ begin if (public.forge_katana('test_z2') ->> 'steel')::int <> 0 then raise exception 'NG'; end if; raise notice 'OK 新しい箱の絶も玉鋼6000で鍛えられる'; end $$;
reset role;
rollback;
-- 絶0.5%を大きく引いて確かめる（2万回で 100 前後）
update public.saves set coins = 10000000 where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
create temp table p3 as select public.pull_gacha(1000) g from generate_series(1, 20);
reset role;
select 'zetsu in 20000 pulls (expect ~100)', count(*) from p3, jsonb_array_elements(g->'got') x join public.katana_catalog c on c.id = x->>'id' where c.tier = '絶';
