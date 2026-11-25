#!/bin/sh
# 手元の PostgreSQL 16 で chat.sql を試す。使い方: sh tests/chat-db-test.sh
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-chat}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5498 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5498 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -f supabase/ranking.sql
$Q -f supabase/chat.sql
$Q -f tests/chat-db-test.sql
echo '--- もう一度実行（アップデートのまね）'
$Q -f supabase/schema.sql
$Q -f supabase/chat.sql
$Q -Atc "select count(*) from public.chat_messages"
echo OK
