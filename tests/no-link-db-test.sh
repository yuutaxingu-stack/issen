#!/bin/sh
# 手元の PostgreSQL 16 でリンク禁止を試す。使い方: sh tests/no-link-db-test.sh
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-nolink}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5502 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5502 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
for f in schema save-data ranking chat profile; do $Q -f supabase/$f.sql; done
$Q -f tests/no-link-db-test.sql
echo '--- 本番向けの no-links.sql を2回実行（片づけと、何度でも大丈夫か）'
$Q -f supabase/no-links.sql
$Q -f supabase/no-links.sql
$Q -Atc "select 'NG 残った発言 ' || body from public.chat_messages where body like '%t.me%'"
R=$($Q -Atc "select (select count(*) from public.chat_messages where body like '%t.me%') || ',' || (select word from public.profile_ext where id = '22222222-2222-2222-2222-222222222222') || ',' || (select name from public.profiles where id = '22222222-2222-2222-2222-222222222222') || ',' || (select count(*) from public.chat_messages where body like '%github.io%')")
[ "$R" = "0,,bbb,1" ] || { echo "NG 片づけ: $R"; exit 1; }
echo "OK 片づけ（リンク発言0・一言空・名前はログインID・神様の発言は残る）"
echo OK
