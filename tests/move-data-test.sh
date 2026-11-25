#!/bin/sh
# 手元の PostgreSQL 16 で move-data.sql（古いプロジェクト→新しいプロジェクトへ丸ごと写す）を試す。
# 古い側に団体戦・寄合のテストデータを作り、新しい側へ写して、全部の表の中身が同じになるかを確かめる。
# 使い方: sh tests/move-data-test.sh   （KEEP=1 でデータベースを残す）
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-move}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
[ -d "$D/data" ] && $RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null 2>&1 || true
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5497 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
P="psql -h $D -p 5497 -U postgres -v ON_ERROR_STOP=1 -q"
Q="$P"; P="$P -o /dev/null"; export PGOPTIONS="-c client_min_messages=warning"
$P -c 'create database old' -c 'create database new'
# 本物の auth に近づける: パスワード、自動で計算される列、identities
EXTRA="alter table auth.users add column encrypted_password text default 'hash', add column email text default 'x@y', add column email_low text generated always as (lower(email)) stored;
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, provider text default 'email', email text generated always as ('e') stored);"
for db in old new; do
  if [ $db = old ]; then $P -d $db -f tests/supabase-stub.sql; else grep -v "^create role" tests/supabase-stub.sql | $P -d $db; fi
  $P -d $db -c "$EXTRA"
  for f in schema save-data ranking chat team; do $P -d $db -f supabase/$f.sql; done
done
$P -d old -f tests/team-db-test.sql 2>/dev/null
$P -d old -c "update auth.users set encrypted_password = 'pw-' || id; insert into auth.identities (user_id) select id from auth.users;
  update public.app_config set pull_cost = 12; insert into public.saves (id) select id from public.profiles; insert into public.ratings (id) select id from public.profiles;" 
# 新しい側にも余計なものを入れておく（写すと消えるはず）
$P -d new -c "insert into auth.users (id, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', '{\"login\":\"zzz\",\"name\":\"余\"}')"
sed -e "s#{{HOST}}#$D#; s#{{PORT}}#5497#; s#{{DB}}#old#; s#{{USER}}#postgres#; s#{{PASS}}#x#; s#sslmode 'require'#sslmode 'disable'#" supabase/move-data.sql > "$D/move.sql"
$Q -d new -f "$D/move.sql"
echo '--- もう一度写す（やり直しのまね）'
$P -d new -f "$D/move.sql" >/dev/null
dump(){ for t in $($Q -d $1 -Atc "select 'auth.users' union all select 'auth.identities' union all select 'public.'||relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='public' and relkind='r' order by 1"); do
  echo "== $t"; $Q -d $1 -Atc "select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ' ' || count(*) from $t x"; done; }
dump old > "$D/old.txt"; dump new > "$D/new.txt"
if cmp -s "$D/old.txt" "$D/new.txt"; then echo "OK 全部の表が同じ（$(grep -c '==' $D/old.txt)表）"; else echo 'NG 違いあり'; diff "$D/old.txt" "$D/new.txt"; exit 1; fi
$Q -d new -Atc "select count(*) from pg_foreign_server" | grep -qx 0 && echo 'OK 古い側への接続（パスワード）は消えた' || { echo 'NG 接続が残った'; exit 1; }
# 写した後も普通に動くか: 寄合に発言（番号が続きから振られる）、新しい利用者の登録
$P -d new -c "insert into auth.users (id, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', '{\"login\":\"newbie\",\"name\":\"新\"}')"
$Q -d new -Atc "select count(*) from public.profiles where id = '88888888-8888-8888-8888-888888888888'" | grep -qx 1 && echo 'OK 写した後の新規登録で名前が作られる' || { echo 'NG 新規登録'; exit 1; }
$P -d new -c "insert into public.chat_messages (author, kind, body) select id, 'say', 'テスト' from public.profiles limit 1" && echo 'OK 寄合の番号が重ならない' || { $P -d new -c "\d public.chat_messages"; echo 'NG 寄合の番号'; exit 1; }
echo '--- 自動処理を止める設定が使えない場合（表ごとに止める）でも写せるか'
sed -e "s/perform set_config('session_replication_role', 'replica', true);/raise exception 'no replica';/" "$D/move.sql" > "$D/move2.sql"
$Q -d new -f "$D/move2.sql" >/dev/null
dump new > "$D/new2.txt"
if cmp -s "$D/old.txt" "$D/new2.txt"; then echo 'OK こちらの方法でも全部の表が同じ'; else echo 'NG 違いあり'; diff "$D/old.txt" "$D/new2.txt"; exit 1; fi
$Q -d new -Atc "select count(*) from pg_trigger where not tgenabled = 'O' and not tgisinternal" | grep -qx 0 && echo 'OK 止めた処理は元に戻った' || { echo 'NG 処理が止まったまま'; exit 1; }
