-- chat.sql を手元の PostgreSQL で確かめる（tests/chat-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"ccc","name":"丙"}'),
  ('44444444-4444-4444-4444-444444444444', '{"login":"ddd","name":"丁"}');
-- 甲-乙, 甲-丙 はフレンド。丁は甲に申請中。乙と丙はフレンドではない
insert into public.friendships (a, b, requester, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'accepted'),
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'accepted'),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'pending');

create function pg_temp.as_(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); select null::void $$;
create function pg_temp.see(u text) returns text language plpgsql as $$
declare r text; begin
  perform set_config('request.jwt.claim.sub', u, false);
  set local role authenticated;
  select string_agg(kind || '/' || coalesce(nullif(body, ''), ref::text), ' | ' order by id) into r from public.chat_messages;
  reset role;
  return coalesce(r, '(なし)');
end $$;
create function pg_temp.err(sql text) returns text language plpgsql as $$
begin execute sql; return 'エラーにならなかった'; exception when others then return 'エラー: ' || sqlerrm; end $$;

select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select public.chat_post('乙です、よろしく') is not null as "乙の発言";
\echo '--- 連投は止まる'
select pg_temp.err($$select public.chat_post('もう一回')$$);
\echo '--- 長すぎる'
update public.chat_messages set created_at = now() - interval '10 seconds';
select pg_temp.err($$select public.chat_post(repeat('あ', 101))$$);
\echo '--- 甲が乙と丙を名指し（丁はフレンドでないので外れる）'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select public.chat_post('@乙 @丙 一本どうだ', array['22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444']::uuid[]);
select mentions from public.chat_messages order by id desc limit 1;
update public.chat_messages set created_at = now() - interval '10 seconds';
\echo '--- 甲から乙へ内緒'
select public.chat_post('内緒の話', '{}', '22222222-2222-2222-2222-222222222222');
\echo '--- 見える物: 甲 / 乙 / 丙（乙の発言と内緒は見えない） / 丁（何も見えない）'
select pg_temp.see('11111111-1111-1111-1111-111111111111');
select pg_temp.see('22222222-2222-2222-2222-222222222222');
select pg_temp.see('33333333-3333-3333-3333-333333333333');
select pg_temp.see('44444444-4444-4444-4444-444444444444');
\echo '--- 直接書き込めない'
select pg_temp.err($$set role authenticated; insert into public.chat_messages (author, kind, body) values ('33333333-3333-3333-3333-333333333333', 'say', 'x')$$);
reset role;
\echo '--- 相手求む → 丙が応じると対戦ができ、始まりの知らせが出る'
update public.chat_messages set created_at = now() - interval '10 seconds';
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select public.chat_post('', '{}', null, 'recruit') as rid \gset
select pg_temp.as_('44444444-4444-4444-4444-444444444444');
select pg_temp.err($$select public.chat_accept_recruit($$ || :rid || $$)$$) as "丁は応じられない";
select pg_temp.as_('33333333-3333-3333-3333-333333333333');
select public.chat_accept_recruit(:rid) as mid \gset
select pg_temp.err($$select public.chat_accept_recruit($$ || :rid || $$)$$) as "二度目は不可";
\echo '--- 結果が確定すると、終わりの知らせ（勝者と最後の決着名）'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select public.report_result(:'mid', '{"h":["先の先:0","止め:1","明鏡止水:1"],"s":[1,2]}');
select pg_temp.as_('33333333-3333-3333-3333-333333333333');
select public.report_result(:'mid', '{"h":["先の先:0","止め:1","明鏡止水:1"],"s":[1,2]}');
select kind, ref - 'match_id' from public.chat_messages where kind like 'match%' order by id;
\echo '--- 乙は甲のフレンドなので甲と丙の立ち合いも見える'
select pg_temp.see('22222222-2222-2222-2222-222222222222');
\echo '--- 消す（他人のは消せない）'
select pg_temp.as_('33333333-3333-3333-3333-333333333333');
select pg_temp.err($$select public.chat_delete(1)$$);
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select public.chat_delete(1);
select deleted, body from public.chat_messages where id = 1;
\echo '--- 7日より古い発言は片づく'
update public.chat_messages set created_at = now() - interval '10 seconds' where author = '22222222-2222-2222-2222-222222222222';
update public.chat_messages set created_at = now() - interval '8 days' where id = 1;
select public.chat_post('新しい発言');
select count(*) as "id1が残っている数" from public.chat_messages where id = 1;
\echo '--- ミュート'
select public.chat_set_mute('11111111-1111-1111-1111-111111111111', true);
select count(*) from public.chat_mutes;
