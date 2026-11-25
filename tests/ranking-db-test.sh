#!/bin/sh
# 手元の PostgreSQL 16 で、schema.sql・save-data.sql・ranking.sql を試す。
# 「何度実行しても戦闘力が消えない」ことも確かめる。
# 使い方: sh tests/ranking-db-test.sh
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-rank}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5499 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -f supabase/ranking.sql
$Q -f tests/ranking-db-test.sql
$Q -Atc "select id, rating, peak, wins, losses, streak, best_streak from public.ratings order by id; select count(*) from public.rating_log" > "$D/before.txt"
echo '--- 3つのSQLをもう一度実行（アップデートのまね）'
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -f supabase/ranking.sql
$Q -Atc "select id, rating, peak, wins, losses, streak, best_streak from public.ratings order by id; select count(*) from public.rating_log" > "$D/after.txt"
if cmp -s "$D/before.txt" "$D/after.txt"; then echo 'OK もう一度実行しても戦闘力と記録は変わらない'; else echo 'NG 変わった'; diff "$D/before.txt" "$D/after.txt"; exit 1; fi
