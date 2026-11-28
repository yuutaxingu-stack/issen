#!/bin/sh
# 手元の PostgreSQL 16 で zukan.sql（図鑑）を試す。使い方: sh tests/zukan-db-test.sh
set -e
cd "$(dirname "$0")/.."
D=${PGTEST_DIR:-/var/tmp/issen-pgtest-zukan}; BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
RUN=""; [ "$(id -u)" = 0 ] && RUN="su postgres -c"
[ -f "$D/data/postmaster.pid" ] && $RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null 2>&1 || true
rm -rf "$D"; mkdir -p "$D"; [ -n "$RUN" ] && chown postgres "$D"
$RUN "$BIN/initdb -D $D/data -A trust -E UTF8 --locale=C.UTF-8" >/dev/null
$RUN "$BIN/pg_ctl -D $D/data -o '-k $D -p 5498 -c listen_addresses=' -l $D/log -w start" >/dev/null
[ -z "$KEEP" ] && trap '$RUN "$BIN/pg_ctl -D $D/data -m fast stop" >/dev/null' EXIT
Q="psql -h $D -p 5498 -U postgres -v ON_ERROR_STOP=1 -q"
$Q -f tests/supabase-stub.sql
for f in schema save-data ranking profile zukan; do $Q -f supabase/$f.sql; done
$Q -f tests/zukan-db-test.sql
echo '--- もう一度実行（アップデートのまね）'
$Q -Atc "select id, title from public.title_seen order by 1,2" > "$D/before.txt"
for f in profile zukan; do $Q -f supabase/$f.sql; done
$Q -Atc "select id, title from public.title_seen order by 1,2" > "$D/after.txt"
if cmp -s "$D/before.txt" "$D/after.txt"; then echo 'OK もう一度実行しても覚えた二つ名は変わらない'; else echo 'NG 変わった'; diff "$D/before.txt" "$D/after.txt"; exit 1; fi
echo '--- 手紙からの覚え直しと、新・一閃だけの決着の写し'
$Q -c "delete from public.title_seen where id = '11111111-1111-1111-1111-111111111111'; update public.saves set rec = rec || '{\"ruri\":{\"百花\":4}}' where id = '11111111-1111-1111-1111-111111111111'"
$Q -f supabase/zukan.sql >/dev/null
$Q -Atc "select case when exists (select 1 from public.title_seen where id = '11111111-1111-1111-1111-111111111111' and title = 'top_hayate') then 'OK 抜かれた天下　疾風を手紙から覚え直した' else 'NG 覚え直していない' end"
$Q -Atc "select case when (rec_new -> 'ruri' ->> '百花') = '4' and (rec_new -> 'mumei' ->> '明鏡止水') is null then 'OK 百花は新・一閃に写し、明鏡止水は写さない' else 'NG ' || rec_new::text end from public.saves where id = '11111111-1111-1111-1111-111111111111'"
$Q -f supabase/zukan.sql >/dev/null
$Q -Atc "select case when (rec_new -> 'ruri' ->> '百花') = '4' then 'OK もう一度実行しても増えない' else 'NG' end from public.saves where id = '11111111-1111-1111-1111-111111111111'"
