-- profile.sql を手元の PostgreSQL で確かめる（tests/profile-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}'),
  ('99999999-9999-9999-9999-999999999999', '{"login":"kami","name":"神様"}');
insert into public.god_accounts (id) values ('99999999-9999-9999-9999-999999999999');
-- 甲は一閃を決めたことがある。乙は桜華を持つ。丙はどちらもない
insert into public.saves (id, coins, owned, rec) values
  ('11111111-1111-1111-1111-111111111111', 10, '{"mumei":1,"ruri":1}', '{"ruri":{"一閃":1,"疾風":3},"mumei":{"先の先":2}}'),
  ('22222222-2222-2222-2222-222222222222', 0, '{"mumei":1,"ouka":1}', '{"ouka":{"散華":1}}'),
  ('33333333-3333-3333-3333-333333333333', 0, '{"mumei":1}', '{}');

create function pg_temp.as_(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create function pg_temp.expect_err(q text, pat text) returns text language plpgsql as $$
begin execute q; raise exception 'NG 断られるはずが通った: %', q;
exception when others then
  if sqlerrm like 'NG %' then raise; end if;
  if sqlerrm !~ pat then raise exception 'NG 違う理由で断られた: % / %', q, sqlerrm; end if;
  return 'OK 断られた: ' || sqlerrm;
end $$;

\echo '--- ふつうの人は運営の処理を使えない'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_err($$select public.god_preview('all')$$, '神様だけ');
select pg_temp.expect_err($$select public.god_send_mail('all', null, '題', '', '{}')$$, '神様だけ');
select pg_temp.expect_err($$select public.god_post_notice('update', '題', '')$$, '神様だけ');

\echo '--- 神様: 宛先を確かめる（一閃=甲だけ、桜華=乙だけ）'
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select case when (public.god_preview('issen') ->> 'n') = '1' and public.god_preview('issen') -> 'list' -> 0 ->> 'login' = 'aaa' then 'OK 一閃は甲' else 'NG ' || public.god_preview('issen')::text end;
select case when (public.god_preview('katana', 'ouka') ->> 'n') = '1' and public.god_preview('katana', 'ouka') -> 'list' -> 0 ->> 'login' = 'bbb' then 'OK 桜華は乙' else 'NG' end;
select case when (public.god_preview('login', 'aaa, CCC') ->> 'n') = '2' then 'OK ログインIDで二人' else 'NG' end;
select pg_temp.expect_err($$select public.god_preview('katana', 'nai')$$, 'その刀はありません');
select pg_temp.expect_err($$select public.god_send_mail('issen', null, '題', '', '{"titles":["nai"]}')$$, 'その二つ名はありません');

\echo '--- 神様: 送る'
select case when public.god_send_mail('issen', null, '一閃の誉れ', 'おめでとう', '{"titles":["issen"]}') = 1 then 'OK 一閃の二つ名を1通' else 'NG' end;
select case when public.god_send_mail('katana', 'ouka', '桜華の札', '', '{"plates":["ouka"]}') = 1 then 'OK 桜華の背景を1通' else 'NG' end;
select case when public.god_send_mail('all', null, 'お詫び', '', '{"coins":300,"steel":50,"bogus":1}') = 4 then 'OK 全員に銭と玉鋼' else 'NG' end;
select case when (select gifts from public.mail where subject = 'お詫び' limit 1) = '{"coins":300,"steel":50}' then 'OK 知らない添え物は捨てる' else 'NG' end;
select case when jsonb_array_length(public.god_info() -> 'sent') = 3 then 'OK 送った記録' else 'NG' end;

\echo '--- 甲: 文箱を見て受け取る'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select case when (public.my_mail() ->> 'unclaimed') = '2' and public.my_mail() -> 'items' -> 1 -> 'title_names' ->> 0 = '紫電一閃' then 'OK 甲の文箱は2通' else 'NG ' || public.my_mail()::text end;
select pg_temp.expect_err($$select public.set_profile('', null, 'issen', null)$$, 'その二つ名は持っていません');
select case when (public.claim_mail() -> 'got' ->> 'coins') = '300' then 'OK 全部受け取った' else 'NG' end;
select case when (select coins from public.saves where id = auth.uid()) = 310 and (select steel from public.saves where id = auth.uid()) = 50 then 'OK 銭と玉鋼が入った' else 'NG' end;
select case when (public.get_profile(null) ->> 'title_name') = '紫電一閃' then 'OK もらった二つ名をそのまま名乗る' else 'NG' end;
select case when (public.claim_mail() ->> 'n') = '0' then 'OK 二度は受け取れない' else 'NG' end;
select pg_temp.expect_err($$select public.claim_mail((select min(id) from public.mail))$$, 'もう受け取って');

\echo '--- 甲: 名乗りを書き換える'
select pg_temp.expect_err($$select public.set_profile('', 'ouka', null, null)$$, 'その刀を持っていません');
select pg_temp.expect_err($$select public.set_profile('', null, null, 'ouka')$$, 'その背景は持っていません');
select pg_temp.expect_err($$select public.set_profile(repeat('あ', 31), null, null, null)$$, '30文字');
select case when (public.set_profile('  斬って　候  ', 'ruri', 'issen', 'take') ->> 'word') = '斬って 候' then 'OK 一言' else 'NG' end;
select case when jsonb_array_length(public.get_profile(null) -> 'my_plates') = 3 then 'OK 甲の背景は誰でも使える3つ' else 'NG' end;
select case when (public.get_profile(null) ->> 'issen') = '1' and (public.get_profile(null) ->> 'katana') = '2' then 'OK 一閃の回数と刀帳' else 'NG ' || public.get_profile(null)::text end;

\echo '--- 乙: 桜華の背景を受け取り、甲の名乗りを見る'
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select public.claim_mail((select min(id) from public.mail where to_id = auth.uid())) ->> 'n';
select case when (public.set_profile('', 'ouka', null, 'ouka') ->> 'plate') = 'ouka' and (public.get_profile(null) ->> 'zetsu') = 'true' then 'OK 乙は桜華の背景' else 'NG' end;
select case when public.get_profile('11111111-1111-1111-1111-111111111111') ? 'my_titles' then 'NG 他人の持ち物が見えた'
            when (public.get_profile('11111111-1111-1111-1111-111111111111') ->> 'word') = '斬って 候' then 'OK 甲の名乗りが見える' else 'NG' end;
select case when (public.profile_tags(array['11111111-1111-1111-1111-111111111111'::uuid, '33333333-3333-3333-3333-333333333333'::uuid])
                  -> '11111111-1111-1111-1111-111111111111' ->> 'title') = '紫電一閃' then 'OK 一覧に添える二つ名' else 'NG' end;
select case when (select count(*) from public.mail where to_id = auth.uid() and claimed_at is null) = 1 then 'OK 一通だけ受け取った' else 'NG' end;

\echo '--- お知らせ'
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select public.god_post_notice('maint', 'メンテナンスのお知らせ', '12月1日 2時から3時') > 0;
select public.god_post_notice('update', '第二弾の箱', '') > 0;
select pg_temp.expect_err($$select public.god_post_notice('other', '題', '')$$, 'check');
select public.god_delete_notice((select max(id) from public.notices));
reset role;
set role anon; select pg_temp.as_('');
select case when jsonb_array_length(public.list_notices()) = 1 and public.list_notices() -> 0 ->> 'kind' = 'maint' then 'OK ログインなしでも読める・消したものは出ない' else 'NG' end;
select pg_temp.expect_err($$select public.my_mail()$$, 'ログイン|permission');
reset role;
