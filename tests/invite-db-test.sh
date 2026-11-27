#!/bin/sh
# 手元の PostgreSQL 16 で招待コードを試す。使い方: sh tests/invite-db-test.sh
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-inv}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5497 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
export PGOPTIONS="-c client_min_messages=warning"
Q="psql -h $D -p 5497 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
# 本番と同じ順に流してから、差分 invites.sql を当てる
for f in schema save-data ranking team chat profile action-online god-friends no-links; do $Q -f supabase/$f.sql >/dev/null; done
$Q -f supabase/invites.sql
$Q -At -f tests/invite-db-test.sql > "$D/out.txt" 2>&1 || { cat "$D/out.txt"; exit 1; }
grep -E "^(OK|NG)" "$D/out.txt"
echo '--- invites.sql と schema.sql の登録処理が同じか'
$Q -At -c "select md5(prosrc) from pg_proc where proname = 'handle_new_user'" > "$D/a.txt"
$Q -f supabase/schema.sql >/dev/null 2>&1
$Q -At -c "select md5(prosrc) from pg_proc where proname = 'handle_new_user'" > "$D/b.txt"
cmp -s "$D/a.txt" "$D/b.txt" && echo 'OK 同じ' || { echo 'NG 違う'; exit 1; }
echo '--- invites.sql をもう一度実行しても大丈夫か'
$Q -f supabase/invites.sql && echo 'OK'
