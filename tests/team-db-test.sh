#!/bin/sh
# 手元の PostgreSQL 16 で team.sql（団体戦）を試す。
# 使い方: sh tests/team-db-test.sh   （KEEP=1 でデータベースを残す）
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-team}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
[ -d "$D/data" ] && $RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null 2>&1 || true
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
$Q -f supabase/team.sql
$Q -f tests/team-db-test.sql
echo '--- SQLをもう一度すべて実行（アップデートのまね）'
$Q -Atc "select count(*), string_agg(status, ',' order by id) from public.team_rooms; select count(*) from public.matches; select count(*) from public.rating_log" > "$D/before.txt"
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -f supabase/ranking.sql
$Q -f supabase/chat.sql
$Q -f supabase/team.sql
$Q -Atc "select count(*), string_agg(status, ',' order by id) from public.team_rooms; select count(*) from public.matches; select count(*) from public.rating_log" > "$D/after.txt"
if cmp -s "$D/before.txt" "$D/after.txt"; then echo 'OK もう一度実行しても部屋と記録は変わらない'; else echo 'NG 変わった'; diff "$D/before.txt" "$D/after.txt"; exit 1; fi
$Q -Atc "select tgname, pg_get_triggerdef(oid) from pg_trigger where tgname = 'matches_rating'" | grep -q 'room_id IS NULL' && echo 'OK 戦闘力の処理は団体戦の試合で動かない' || { echo 'NG 戦闘力の処理'; exit 1; }
