#!/bin/sh
# 手元の PostgreSQL 16 で、schema.sql と save-data.sql を試す。
# 「何度実行してもデータが消えない」「刀を一覧から外しても持ち物が残る」ことも確かめる。
# 使い方: sh tests/save-db-test.sh   （PostgreSQL が入っている環境で。root なら postgres ユーザーで動かす）
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5498 -c listen_addresses=' -l $D/log -w start" >/dev/null
trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5498 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -f tests/save-db-test.sql
echo '--- 引っ越し・勝ち・ガチャの後の持ち物'
$Q -Atc "select coins, cpu_best, owned, rec, equip from public.saves order by id" > "$D/before.txt"; cat "$D/before.txt"
echo '--- 2つのSQLをもう一度実行（アップデートのまね）。刀を1本一覧から外し、新しい刀を1本足す'
$Q -c "update public.katana_catalog set in_gacha = false where id = 'ruri'; insert into public.katana_catalog values ('shinto_test', '上')" >/dev/null
$Q -f supabase/schema.sql
$Q -f supabase/save-data.sql
$Q -Atc "select coins, cpu_best, owned, rec, equip from public.saves order by id" > "$D/after.txt"
if cmp -s "$D/before.txt" "$D/after.txt"; then echo 'OK もう一度実行しても持ち物は変わらない'; else echo 'NG 持ち物が変わった'; diff "$D/before.txt" "$D/after.txt"; exit 1; fi
$Q -Atc "select 'OK 外した刀も一覧に行が残る: ' || count(*) from public.katana_catalog where id in ('ruri','shinto_test')"
