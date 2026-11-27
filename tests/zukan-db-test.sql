-- zukan.sql を手元の PostgreSQL で確かめる（tests/zukan-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('99999999-9999-9999-9999-999999999999', '{"login":"kami","name":"神様"}');
insert into public.god_accounts (id) values ('99999999-9999-9999-9999-999999999999');
create function pg_temp.as_(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create function pg_temp.t(j jsonb, id text) returns jsonb language sql as $$ select x from jsonb_array_elements(j -> 'titles') x where x ->> 'id' = id $$;
create function pg_temp.veiled(j jsonb) returns int language sql as $$ select count(*)::int from jsonb_array_elements(j -> 'titles') x where x ->> 'name' is null $$;

-- 甲が疾風を3回決めて「天下　疾風」を手にする
insert into public.saves (id, coins, owned, rec) values
  ('11111111-1111-1111-1111-111111111111', 0, '{"mumei":1}', '{"mumei":{"疾風":3}}'),
  ('22222222-2222-2222-2222-222222222222', 0, '{"mumei":1}', '{}');

\echo '--- 甲: 天下　疾風を持つので見える。ほかの隠し二つ名は伏せてある'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select case when pg_temp.t(public.zukan(), 'top_hayate') ->> 'have' = 'true' then 'OK 甲は天下　疾風を持つ' else 'NG ' || public.zukan()::text end;
select case when pg_temp.t(public.zukan(), 'top_wins') ->> 'have' = 'true' then 'OK 甲は剣聖も持つ' else 'NG' end;
select case when pg_temp.t(public.zukan(), 'top_meikyo') is null and pg_temp.veiled(public.zukan()) > 10 then 'OK 持ったことのない隠し二つ名は名前が出ない' else 'NG' end;
select case when pg_temp.t(public.zukan(), 'issen') ->> 'have' = 'false' and pg_temp.t(public.zukan(), 'issen') ->> 'note' <> '' then 'OK ふつうの二つ名は持っていなくても条件が見える' else 'NG' end;
select case when (select count(*) from jsonb_array_elements(public.zukan() -> 'plates') p where p ->> 'have' = 'true') = 3 then 'OK 背景は無料の3つだけ持つ' else 'NG' end;

\echo '--- 乙: まだ何もないので伏せてある'
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select case when pg_temp.t(public.zukan(), 'top_hayate') is null then 'OK 乙には天下　疾風が見えない' else 'NG' end;

\echo '--- 乙が抜く → 甲は名前を覚えたまま、持ってはいない'
select pg_temp.as_('');
update public.saves set rec = '{"mumei":{"疾風":5}}' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select case when pg_temp.t(public.zukan(), 'top_hayate') ->> 'have' = 'true' then 'OK 乙が持つ' else 'NG' end;
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select case when pg_temp.t(public.zukan(), 'top_hayate') ->> 'have' = 'false' and pg_temp.t(public.zukan(), 'top_hayate') ->> 'seen' = 'true' then 'OK 甲は知っているが今は持たない' else 'NG ' || coalesce(pg_temp.t(public.zukan(), 'top_hayate')::text, 'null') end;

\echo '--- 神様は全部見えて全部持つ'
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select case when pg_temp.veiled(public.zukan()) = 0 and pg_temp.t(public.zukan(), 'top_meikyo') ->> 'have' = 'true' then 'OK 神様' else 'NG' end;

\echo '--- ログインしていなければ断る'
select pg_temp.as_('');
do $$ begin perform public.zukan(); raise exception 'NG 通った'; exception when others then if sqlerrm like 'NG%' then raise; end if; raise notice 'OK 断られた: %', sqlerrm; end $$;
