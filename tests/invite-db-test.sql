-- 招待コードを手元の PostgreSQL で確かめる（tests/invite-db-test.sh から実行）
\set ON_ERROR_STOP 1
set issen.no_invite = 'off';
create function pg_temp.ok(c boolean, m text) returns text language plpgsql as $$
begin if not c then raise exception 'NG %', m; end if; return 'OK ' || m; end $$;
-- 登録を試す（失敗したらその文言を返す）
create function pg_temp.reg(id uuid, meta jsonb) returns text language plpgsql as $$
begin insert into auth.users values (id, meta); return 'ok';
exception when others then return sqlerrm; end $$;

\echo '--- すでにいる人（招待コード前に登録）'
set issen.no_invite = 'on';
insert into auth.users values ('11111111-1111-1111-1111-111111111111', '{"login":"kami","name":"神様"}'),
                              ('22222222-2222-2222-2222-222222222222', '{"login":"old","name":"古参"}');
set issen.no_invite = 'off';
insert into public.god_accounts (id) values ('11111111-1111-1111-1111-111111111111');
select pg_temp.ok((select count(*) from public.profiles) = 2, 'すでにいる人はそのまま');

\echo '--- コードなし・でたらめなコードでは登録できない'
select pg_temp.ok(pg_temp.reg('33333333-3333-3333-3333-333333333333', '{"login":"nocode","name":"無"}') like '招待コードが違う%', 'コードなしは断る');
select pg_temp.ok(pg_temp.reg('33333333-3333-3333-3333-333333333333', '{"login":"nocode","name":"無","invite":"ABCD2345"}') like '招待コードが違う%', 'でたらめなコードは断る');
select pg_temp.ok(not exists (select 1 from auth.users where id = '33333333-3333-3333-3333-333333333333'), '断ったら登録の行も残らない');
select pg_temp.ok(not exists (select 1 from public.profiles where login = 'nocode'), 'プロフィールも作られない');

\echo '--- 権限: 神様だけが作れる・見られる。use_invite は誰も直接呼べない'
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin perform public.invite_create('x', 1); raise exception 'NG 神様でない人が作れた';
exception when others then if sqlerrm like 'NG%' then raise; end if; end $$;
do $$ begin perform public.invite_list(); raise exception 'NG 神様でない人が一覧を見られた';
exception when others then if sqlerrm like 'NG%' then raise; end if; end $$;
do $$ begin perform public.use_invite(auth.uid(), 'ABCD2345'); raise exception 'NG use_invite を呼べた';
exception when insufficient_privilege then null; end $$;
do $$ begin perform * from public.invite_codes; raise exception 'NG 表を直接読めた';
exception when insufficient_privilege then null; end $$;
select 'OK 神様でない人は作れない・一覧も表も見られない';

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create temp table c as select public.invite_create('たけし用', 3) as code;
select pg_temp.ok((select count(*) from c) = 3 and (select bool_and(code ~ '^[A-HJ-NP-Z2-9]{8}$') from c), '神様は3個作れる（8文字・紛らわしい字なし）');
select pg_temp.ok((select count(*) from public.invite_list() where memo = 'たけし用' and used_at is null) = 3, '一覧に出る（未使用）');
reset role;
grant select on c to anon, authenticated;

\echo '--- 登録画面の確かめ（誰でも）'
set role anon;
select pg_temp.ok(public.invite_ok((select code from c limit 1)), '使えるコードは true');
select pg_temp.ok(public.invite_ok(lower(substr((select code from c limit 1),1,4) || '-' || substr((select code from c limit 1),5))), '小文字・ハイフン入りでも通る');
select pg_temp.ok(not public.invite_ok('ZZZZZZZZ'), 'でたらめは false');
do $$ begin perform public.invite_create('x', 1); raise exception 'NG anon が作れた';
exception when insufficient_privilege then null; end $$;
reset role;

\echo '--- コードで登録できる・2回目は使えない'
select pg_temp.ok(pg_temp.reg('44444444-4444-4444-4444-444444444444', jsonb_build_object('login','takeshi','name','たけし','invite',lower((select code from c order by code limit 1)))) = 'ok', 'コードで登録できる（小文字でも）');
select pg_temp.ok(exists (select 1 from public.profiles where login = 'takeshi'), 'プロフィールができる');
select pg_temp.ok(pg_temp.reg('55555555-5555-5555-5555-555555555555', jsonb_build_object('login','friend2','name','又','invite',(select code from c order by code limit 1))) like '招待コードが違う%', '同じコードは2回目に使えない');
set role authenticated;
select pg_temp.ok((select used_login from public.invite_list() where code = (select code from c order by code limit 1)) = 'takeshi', '一覧で誰が使ったか分かる');
select pg_temp.ok(not public.invite_ok((select code from c order by code limit 1)), '使ったコードは false');

\echo '--- 取り消し'
select pg_temp.ok(not public.invite_revoke((select code from c order by code limit 1)), '使ったコードは取り消せない');
select pg_temp.ok(public.invite_revoke((select code from c order by code desc limit 1)), '未使用は取り消せる');
reset role;
select pg_temp.ok(pg_temp.reg('55555555-5555-5555-5555-555555555555', jsonb_build_object('login','friend2','name','又','invite',(select code from c order by code desc limit 1))) like '招待コードが違う%', '取り消したコードでは登録できない');

\echo '--- 招待コードを止めると誰でも登録できる'
update public.app_config set invite_required = false;
select pg_temp.ok(public.invite_ok(''), '止めたら確かめは true');
select pg_temp.ok(pg_temp.reg('66666666-6666-6666-6666-666666666666', '{"login":"free","name":"自由"}') = 'ok', '止めたらコードなしで登録できる');
update public.app_config set invite_required = true;
select pg_temp.ok((select count(*) from public.friendships where status = 'accepted') = 3, '新しく登録した人も神様とフレンド');
