#!/bin/sh
# 手元の PostgreSQL 16 で profile.sql（名乗り・文箱・お知らせ）を試す。
# 「何度実行しても名乗り・文箱・お知らせが消えない」ことも確かめる。
# 使い方: sh tests/profile-db-test.sh（KEEP=1 で終わってもデータベースを止めない。tests/profile-flow-test.js 用）
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-prof}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
[ -f "$D/data/postmaster.pid" ] && $RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null 2>&1 || true
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5499 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
for f in schema save-data ranking profile; do $Q -f supabase/$f.sql; done
$Q -f tests/profile-db-test.sql
# 外しておいた隠し二つ名を全部戻す（ここで一度実行してから、もう一度実行しても変わらないことを確かめる）
$Q -f supabase/profile.sql
SNAP="select id, word, fav, title, plate, titles, plates from public.profile_ext order by id; select id, to_id, claimed_at is null from public.mail order by id; select id, title from public.notices order by id"
$Q -Atc "$SNAP" > "$D/before.txt"
echo '--- SQLをもう一度実行（アップデートのまね）'
for f in schema save-data ranking profile; do $Q -f supabase/$f.sql; done
$Q -Atc "$SNAP" > "$D/after.txt"
if cmp -s "$D/before.txt" "$D/after.txt"; then echo 'OK もう一度実行しても名乗り・文箱・お知らせは変わらない'; else echo 'NG 変わった'; diff "$D/before.txt" "$D/after.txt"; exit 1; fi
