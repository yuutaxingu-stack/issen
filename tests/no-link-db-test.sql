-- リンク禁止（has_link と各処理）を手元の PostgreSQL で確かめる（tests/no-link-db-test.sh から実行）
\set ON_ERROR_STOP 1
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', '{"login":"aaa","name":"甲"}'),
  ('22222222-2222-2222-2222-222222222222', '{"login":"bbb","name":"乙"}'),
  ('33333333-3333-3333-3333-333333333333', '{"login":"cccccccccccccc","name":"見て x.com"}'),
  ('99999999-9999-9999-9999-999999999999', '{"login":"kami","name":"神様"}');
insert into public.god_accounts (id) values ('99999999-9999-9999-9999-999999999999') on conflict do nothing;
insert into public.friendships (a, b, requester, status) values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'accepted')
  on conflict (a, b) do nothing;

create function pg_temp.as_(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); select null::void $$;
create function pg_temp.expect_err(q text, pat text) returns text language plpgsql as $$
begin execute q; raise exception 'NG 断られるはずが通った: %', q;
exception when others then
  if sqlerrm like 'NG %' then raise; end if;
  if sqlerrm !~ pat then raise exception 'NG 違うエラー: % (%)', sqlerrm, q; end if;
  return 'OK 断られた: ' || sqlerrm;
end $$;
create function pg_temp.ok(c boolean, what text) returns text language plpgsql as $$
begin if not coalesce(c, false) then raise exception 'NG %', what; end if; return 'OK ' || what; end $$;

\echo '--- 判定（画面側と同じ例）'
\set cases `cat tests/no-link-cases.json`
select pg_temp.ok(bool_and(public.has_link(x)), 'リンクを全部見つける')
  from jsonb_array_elements_text((:'cases')::jsonb -> 'link') x;
select x as "見逃し" from jsonb_array_elements_text((:'cases')::jsonb -> 'link') x where not public.has_link(x);
select x as "誤検出" from jsonb_array_elements_text((:'cases')::jsonb -> 'ok') x where public.has_link(x);
select pg_temp.ok(not bool_or(public.has_link(x)), 'ふつうの文は通す')
  from jsonb_array_elements_text((:'cases')::jsonb -> 'ok') x;

\echo '--- 登録: リンク入りの名前はログインID（10文字まで）になる'
select pg_temp.ok(name = 'cccccccccc', '登録時の名前 ' || name) from public.profiles where id = '33333333-3333-3333-3333-333333333333';

\echo '--- 寄合'
select pg_temp.as_('11111111-1111-1111-1111-111111111111');
select pg_temp.expect_err($$select public.chat_post('ここ見て https://example.com')$$, 'リンク');
select pg_temp.expect_err($$select public.chat_post('ｄｉｓｃｏｒｄ．ｇｇ／ａｂｃ', '{}', '22222222-2222-2222-2222-222222222222')$$, 'リンク');
select pg_temp.ok(public.chat_post('いざ、勝負。1.5倍') is not null, 'ふつうの発言は通る');
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select pg_temp.ok(public.chat_post('神様のお知らせ https://yuutaxingu-stack.github.io/issen/') is not null, '神様はリンクを書ける');

\echo '--- 名前'
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_err($$select public.set_name('abc.com')$$, 'リンク');
select public.set_name('乙二');
select pg_temp.ok(name = '乙二', 'ふつうの名前は変えられる') from public.profiles where id = '22222222-2222-2222-2222-222222222222';
select pg_temp.as_('99999999-9999-9999-9999-999999999999');
select public.set_name('kami.jp');
select pg_temp.ok(name = 'kami.jp', '神様は名前にも書ける') from public.profiles where id = '99999999-9999-9999-9999-999999999999';

\echo '--- 名乗りの一言'
select pg_temp.as_('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_err($$select public.set_profile('www.example.jp へどうぞ', null, null, null)$$, 'リンク');
select pg_temp.ok((public.set_profile('一閃を極める', null, null, null) ->> 'word') = '一閃を極める', 'ふつうの一言は通る');

\echo '--- 前から書かれていたリンクを用意（no-links.sql の片づけを試す）'
insert into public.chat_messages (author, kind, body) values ('22222222-2222-2222-2222-222222222222', 'say', '前の発言 t.me/abc');
update public.profile_ext set word = 'line.me/xx' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set name = 'bbb.net' where id = '22222222-2222-2222-2222-222222222222';
