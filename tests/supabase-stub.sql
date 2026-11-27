-- 手元の PostgreSQL で schema.sql / save-data.sql を試すための、Supabase のまね
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema realtime;
create table realtime.messages (id int);
create function realtime.topic() returns text language sql as $$ select '' $$;
grant usage on schema realtime to authenticated;
alter table realtime.messages enable row level security;
create publication supabase_realtime;
-- 招待コードの確かめを手元のテストでは飛ばす（招待コードのテスト tests/invite-db-test.sql では入れ直す）
alter database postgres set issen.no_invite = 'on';
