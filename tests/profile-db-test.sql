-- profile.sql を手元の PostgreSQL で確かめる（tests/profile-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}'),
  ('99999999-9999-9999-9999-999999999999', '{"login":"kami","name":"神様"}');
insert into public.god_accounts (id) values ('99999999-9999-9999-9999-999999999999');
-- 隠し二つ名は最後にまとめて確かめる（それまでは外しておく）
delete from public.crowns;
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

\echo '--- 条件を満たした人には自動で届く（甲=一閃、乙=桜華。丙と神様には届かない）'
select case when (select string_agg(p.login || ':' || m.subject, ',' order by p.login) from public.mail m join public.profiles p on p.id = m.to_id) = 'aaa:一閃の誉れ,bbb:桜華の札'
  then 'OK 自動の贈り物' else 'NG ' || (select string_agg(p.login || ':' || m.subject, ',') from public.mail m join public.profiles p on p.id = m.to_id) end;

\echo '--- 神様: 名前かログインIDで送る'
select case when (public.god_preview('login', '甲、ccc') ->> 'n') = '2' then 'OK 名前とログインIDを混ぜて二人' else 'NG' end;
select case when public.god_send_mail('login', '甲', '銭を', '', '{"coins":100}') = 1 then 'OK 名前で銭を1通' else 'NG' end;
select case when public.god_send_mail('all', null, 'お詫び', '', '{"coins":300,"steel":50,"bogus":1}') = 4 then 'OK 全員に銭と玉鋼' else 'NG' end;
select case when (select gifts from public.mail where subject = 'お詫び' limit 1) = '{"coins":300,"steel":50}' then 'OK 知らない添え物は捨てる' else 'NG' end;
select case when jsonb_array_length(public.god_info() -> 'sent') = 4 and jsonb_array_length(public.god_info() -> 'auto') = (select count(*) from public.auto_gifts) then 'OK 送った記録と自動の贈り物' else 'NG' end;
\echo '--- 神様は二つ名・背景・刀を全部持っている'
select case when jsonb_array_length(public.get_profile(null) -> 'my_titles') >= 1 and jsonb_array_length(public.get_profile(null) -> 'my_plates') = (select count(*) from public.plate_catalog)
            and (public.set_profile('', 'geppaku', 'issen', 'ouka') ->> 'title_name') = '一閃' then 'OK 神様は何でも名乗れる' else 'NG' end;

\echo '--- 甲: 文箱を見て受け取る'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select case when (public.my_mail() ->> 'unclaimed') = '3' and public.my_mail() -> 'items' -> 2 -> 'title_names' ->> 0 = '一閃' then 'OK 甲の文箱は3通' else 'NG ' || public.my_mail()::text end;
select pg_temp.expect_err($$select public.set_profile('', null, 'issen', null)$$, 'その二つ名は持っていません');
select case when (public.claim_mail() -> 'got' ->> 'coins') = '400' then 'OK 全部受け取った' else 'NG' end;
select case when (select coins from public.saves where id = auth.uid()) = 410 and (select steel from public.saves where id = auth.uid()) = 50 then 'OK 銭と玉鋼が入った' else 'NG' end;
select case when (public.get_profile(null) ->> 'title_name') = '一閃' then 'OK もらった二つ名をそのまま名乗る' else 'NG' end;
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
                  -> '11111111-1111-1111-1111-111111111111' ->> 'title') = '一閃' then 'OK 一覧に添える二つ名' else 'NG' end;
select case when (select count(*) from public.mail where to_id = auth.uid() and claimed_at is null) = 1 then 'OK 一通だけ受け取った' else 'NG' end;

\echo '--- あとから条件を満たしても届く。手で送られた人と、二度目には届かない'
reset role;
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select public.god_send_mail('login', 'ccc', '先に手で', '', '{"titles":["issen"]}');
update public.saves set rec = '{"mumei":{"一閃":1}}' where id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333');
update public.saves set rec = '{"mumei":{"一閃":2}}' where id = '22222222-2222-2222-2222-222222222222';
select case when (select count(*) from public.mail where to_id = '22222222-2222-2222-2222-222222222222' and subject = '一閃の誉れ') = 1
            and (select count(*) from public.mail where to_id = '33333333-3333-3333-3333-333333333333' and gifts -> 'titles' ? 'issen') = 1
  then 'OK 乙に一通だけ自動で届き、手で送られた丙には重ねない' else 'NG' end;

\echo '--- 絶の刀（桜華）で一閃を決めると「桜華一閃」が届き、受け取ると名乗り替える'
update public.saves set rec = '{"mumei":{"一閃":2},"ouka":{"一閃":1}}' where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select case when (select count(*) from public.mail where to_id = auth.uid() and gifts -> 'titles' ? 'issen_ouka') = 1 then 'OK 桜華一閃が届いた' else 'NG' end;
select public.claim_mail() ->> 'n';
select case when (public.get_profile(null) ->> 'title_name') = '桜華一閃' and (public.get_profile(null) ->> 'title_style') = 'zetsu' then 'OK 桜華一閃を名乗る（絶の見た目）' else 'NG ' || public.get_profile(null)::text end;
reset role;

\echo '--- 運営へ: 不具合報告・改善依頼'
select pg_temp.as_('33333333-3333-3333-3333-333333333333');
select public.send_report('bug', '  画面が止まった  ', 'iPhone') > 0;
select public.send_report('request', '刀帳を並べ替えたい') > 0;
select pg_temp.expect_err($$select public.send_report('bug', '   ')$$, '中身を書いて');
select pg_temp.expect_err($$select public.send_report('other', 'x')$$, '種類');
select pg_temp.expect_err($$select public.god_reports()$$, '神様だけ');
select case when jsonb_array_length(public.my_reports()) = 2 and public.my_reports() -> 1 ->> 'body' = '画面が止まった' then 'OK 送ったものが見える' else 'NG' end;
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select case when (public.god_reports() ->> 'new') = '2' and public.god_reports() -> 'items' -> 0 ->> 'login' = 'ccc' then 'OK 神様に届いた' else 'NG' end;
select public.god_report_mark((select min(id) from public.reports), 'done', '直しました。ありがとう');
select pg_temp.as_('33333333-3333-3333-3333-333333333333');
select case when public.my_reports() -> 1 ->> 'status' = 'done' and public.my_reports() -> 1 ->> 'reply' = '直しました。ありがとう'
            and exists (select 1 from public.mail where to_id = auth.uid() and subject = '不具合報告へのお返事' and body like '直しました%画面が止まった%返事を書けます。') then 'OK 返事が文箱に届く' else 'NG' end;
do $$ begin for i in 1..8 loop perform public.send_report('request', 'たくさん'); end loop; end $$;
select pg_temp.expect_err($$select public.send_report('request', 'もう一通')$$, '1日10通');
reset role;

\echo '--- お知らせ'
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select public.god_post_notice('maint', 'メンテナンスのお知らせ', '12月1日 2時から3時') > 0;
select public.god_post_notice('update', '第二弾の箱', '') > 0;
select pg_temp.expect_err($$select public.god_post_notice('other', '題', '')$$, 'check');
select public.god_post_notice('special', '八咫、近日', '日食の刀', 'yata') > 0;
select pg_temp.expect_err($$select public.god_post_notice('special', '題', '')$$, '刀を選んで');
select (public.list_notices() -> 0 ->> 'art') = 'yata' as special_art;
reset role; delete from public.notices where art = 'yata'; select max(id) as nid from public.notices \gset
set role authenticated;
select public.god_delete_notice(:nid);
reset role;
set role anon; select pg_temp.as_('');
select case when jsonb_array_length(public.list_notices()) = 1 and public.list_notices() -> 0 ->> 'kind' = 'maint' then 'OK ログインなしでも読める・消したものは出ない' else 'NG' end;
select pg_temp.expect_err($$select public.my_mail()$$, 'ログイン|permission');
reset role;

\echo '--- 隠し二つ名: 一番の人だけが持ち、抜かれたら移る'
reset role;
insert into public.crowns (title, kind, arg) values
  ('top_meikyo', 'finish', '明鏡止水'), ('top_issen', 'finish', '一閃'), ('top_wins', 'wins', null),
  ('top_cpu', 'cpu', null), ('top_katana', 'katana', null), ('top_rating', 'rating', null),
  ('top_issen_ouka', 'finish_kat', 'ouka:一閃'), ('top_kagero', 'finish', '陽炎');
update public.saves set rec = rec || '{"ruri":{"明鏡止水":3,"一閃":1}}' where id = '11111111-1111-1111-1111-111111111111';
update public.saves set rec = rec || '{"ouka":{"明鏡止水":2,"一閃":1}}' where id = '22222222-2222-2222-2222-222222222222';
select case when (select holder from public.crowns where title = 'top_meikyo') = '11111111-1111-1111-1111-111111111111'
            and (select 'top_meikyo' = any(titles) from public.profile_ext where id = '11111111-1111-1111-1111-111111111111')
            and exists (select 1 from public.mail where to_id = '11111111-1111-1111-1111-111111111111' and subject = '隠し二つ名「天下　明鏡止水」')
  then 'OK 明鏡止水の達人は甲（3回）' else 'NG' end;
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select public.set_profile('', null, 'top_meikyo', null) ->> 'title_name';
reset role;
\echo '--- 乙が並んでも甲のまま、抜いたら乙へ移る'
update public.saves set rec = rec || '{"ouka":{"明鏡止水":3,"一閃":1}}' where id = '22222222-2222-2222-2222-222222222222';
select case when (select holder from public.crowns where title = 'top_meikyo') = '11111111-1111-1111-1111-111111111111' then 'OK 並びは今の持ち主' else 'NG' end;
update public.saves set rec = rec || '{"ouka":{"明鏡止水":4,"一閃":1}}' where id = '22222222-2222-2222-2222-222222222222';
select case when (select holder from public.crowns where title = 'top_meikyo') = '22222222-2222-2222-2222-222222222222'
            and not (select 'top_meikyo' = any(titles) from public.profile_ext where id = '11111111-1111-1111-1111-111111111111')
            and (select title from public.profile_ext where id = '11111111-1111-1111-1111-111111111111') is distinct from 'top_meikyo'
            and exists (select 1 from public.mail where to_id = '11111111-1111-1111-1111-111111111111' and subject = '「天下　明鏡止水」が移りました' and body like '%乙さん%')
            and exists (select 1 from public.mail where to_id = '22222222-2222-2222-2222-222222222222' and subject = '隠し二つ名「天下　明鏡止水」')
  then 'OK 乙へ移り、甲からは外れて名乗りも替わり、二人に知らせ' else 'NG' end;
select case when (select count(*) from public.crowns where holder = '99999999-9999-9999-9999-999999999999') = 0 then 'OK 神様は数えない' else 'NG' end;
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select case when not exists (select 1 from jsonb_array_elements(public.god_info() -> 'titles') t where t ->> 'id' like 'top_%')
            and jsonb_array_length(public.god_info() -> 'crowns') = 8 then 'OK 神様の画面: 隠し二つ名は手で送れず、持ち主の一覧が見える' else 'NG' end;
reset role;
\echo '--- 天下　桜華一閃（桜華で一閃）・天下　陽炎'
select case when (select holder from public.crowns where title = 'top_issen_ouka') = '22222222-2222-2222-2222-222222222222'
  then 'OK 天下　桜華一閃は乙（桜華で一閃1回）' else 'NG ' || coalesce((select holder::text from public.crowns where title = 'top_issen_ouka'), 'なし') end;
update public.saves set rec = rec || '{"ruri":{"明鏡止水":3,"一閃":1,"陽炎":5}}' where id = '11111111-1111-1111-1111-111111111111';
select case when (select holder from public.crowns where title = 'top_kagero') = '11111111-1111-1111-1111-111111111111'
            and (select name from public.title_catalog where id = 'top_kagero') = '天下　陽炎' then 'OK 天下　陽炎は甲' else 'NG' end;

\echo '--- 神様は全部を持つ（天下の持ち主は変えない）'
select case when (select s.owned @> (select jsonb_object_agg(c.id, 1) from public.katana_catalog c) from public.saves s where s.id = '99999999-9999-9999-9999-999999999999')
            and (select e.titles @> (select array_agg(id) from public.title_catalog) and e.plates @> (select array_agg(id) from public.plate_catalog) from public.profile_ext e where e.id = '99999999-9999-9999-9999-999999999999')
  then 'OK 神様は刀・二つ名（隠しも）・背景を全部持つ' else 'NG' end;
insert into public.katana_catalog (id, tier) values ('zz_test', '並');
insert into public.title_catalog (id, name, note, ord) values ('zz_t', '試し', '', 999);
select case when (select owned ? 'zz_test' from public.saves where id = '99999999-9999-9999-9999-999999999999')
            and (select 'zz_t' = any(titles) from public.profile_ext where id = '99999999-9999-9999-9999-999999999999')
  then 'OK 刀や二つ名を足すと神様にも入る' else 'NG' end;
delete from public.katana_catalog where id = 'zz_test'; delete from public.title_catalog where id = 'zz_t';
update public.saves set owned = owned - 'zz_test' where id = '99999999-9999-9999-9999-999999999999';
update public.profile_ext set titles = array_remove(titles, 'zz_t') where id = '99999999-9999-9999-9999-999999999999';
select case when (select holder from public.crowns where title = 'top_kagero') = '11111111-1111-1111-1111-111111111111'
            and (select count(*) from public.crowns where holder = '99999999-9999-9999-9999-999999999999') = 0
            and (select 'top_kagero' = any(titles) from public.profile_ext where id = '11111111-1111-1111-1111-111111111111')
  then 'OK 神様が持っても天下の持ち主はそのまま' else 'NG' end;
\echo '--- 八咫: 持てば札、八咫で一閃を決めれば二つ名と天下　八咫一閃'
reset role;
insert into public.crowns (title, kind, arg) values ('top_issen_yata', 'finish_kat', 'yata:一閃') on conflict do nothing;
update public.saves set owned = owned || '{"yata":1}', rec = rec || '{"yata":{"一閃":2}}' where id = '33333333-3333-3333-3333-333333333333';
select case when exists (select 1 from public.mail where to_id = '33333333-3333-3333-3333-333333333333' and subject = '八咫の札')
            and exists (select 1 from public.mail where to_id = '33333333-3333-3333-3333-333333333333' and subject = '八咫一閃の誉れ')
            and (select holder from public.crowns where title = 'top_issen_yata') = '33333333-3333-3333-3333-333333333333'
            and (select name from public.title_catalog where id = 'top_issen_yata') = '天下　八咫一閃'
  then 'OK 八咫の札・八咫一閃・天下　八咫一閃が丙に' else 'NG' end;
\echo '--- 運営とのやりとり（返事の返事）'
reset role; select id as rid, from_id as rfrom from public.reports order by id limit 1 \gset
set role authenticated;
select pg_temp.as_(:'rfrom');
select public.report_reply(:rid, '続きです');
select case when public.my_reports() -> -1 ->> 'status' = 'new'
            and jsonb_array_length(public.my_reports() -> -1 -> 'msgs') = 2 then 'OK 送った人が返事を書け、運営の届いたに戻る' else 'NG' end;
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_err(format('select public.report_reply(%s, %L)', :rid, 'x'), 'その報告はありません');
reset role;
