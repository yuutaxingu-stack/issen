-- =====================================================================
-- 一閃 銭と刀をアカウントに保存する設定
-- 先に schema.sql を実行してある前提です。
-- Supabase の「SQL Editor」にこのファイルの中身をすべて貼り付けて「Run」を押してください。
--
-- 何度実行しても大丈夫です。表を消したり作り直したりはしません。
-- 足りない表・列だけを作り、処理（関数）と刀の一覧・数値だけを最新にします。
-- 利用者の銭・刀・記録（saves の表）には一切さわりません。
--
-- 守りの考え方:
--   * 銭・刀・記録の表は、ゲームから直接は読み書きできない（RLS で全部閉じる）
--   * 読み書きは下の処理を通してだけ。ガチャのくじはサーバーが引き、銭の計算もサーバーがする
--   * 刀は「id（英字の名前）」で保存する。並び順や番号は使わないので、刀を足しても消しても記録は残る
-- =====================================================================

-- ---------- 刀の一覧（ガチャの中身） ----------
-- 刀をゲームから外したいときは、行を消さずに in_gacha を false にする（持っている人の刀は残る）
create table if not exists public.katana_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  tier text not null check (tier in ('並', '上', '極', '幻')),
  in_gacha boolean not null default true,
  added_at timestamptz not null default now()
);

-- ---------- ガチャの確率と、重なったときに戻る銭 ----------
create table if not exists public.gacha_tiers (
  tier text primary key check (tier in ('並', '上', '極', '幻')),
  weight numeric not null check (weight >= 0),   -- 割合（%）
  dup_back int not null check (dup_back >= 0)    -- 持っている刀が出たときに戻る銭
);

-- ---------- 決着ごとにもらえる銭 ----------
create table if not exists public.finish_coins (
  finish text primary key,
  coins int not null check (coins >= 0)
);

-- ---------- 設定（schema.sql の app_config に列を足す） ----------
alter table public.app_config add column if not exists pull_cost int not null default 10;        -- ガチャ1回の銭
alter table public.app_config add column if not exists day_coin_cap int not null default 15000;  -- 1日に勝負で得られる銭の上限（ずる対策）
alter table public.app_config alter column day_coin_cap set default 15000;
update public.app_config set day_coin_cap = 15000 where day_coin_cap = 5000;  -- 銭3倍(2026-11-26)に合わせて上限も3倍

-- ---------- 一人ひとりの持ち物 ----------
create table if not exists public.saves (
  id uuid primary key references public.profiles(id) on delete cascade,
  coins bigint not null default 0 check (coins >= 0),
  cpu_best int not null default 0 check (cpu_best >= 0),
  owned jsonb not null default '{"mumei": 1}',          -- { 刀id: 本数 }
  rec jsonb not null default '{}',                       -- { 刀id: { 決着名: 回数 } }
  equip jsonb not null default '["mumei", "mumei"]',     -- [朱が持つ刀id, 藍が持つ刀id]
  imports int not null default 0,                        -- 端末の記録を引っ越した回数
  win_min timestamptz,                                   -- 勝ちの記録の数え始め（1分ごと）
  win_count int not null default 0,
  coin_day date,                                         -- 今日の日付と、今日勝負で得た銭
  day_coins int not null default 0,
  pulls bigint not null default 0,                       -- ガチャを引いた回数
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.katana_catalog enable row level security;
alter table public.gacha_tiers enable row level security;
alter table public.finish_coins enable row level security;
alter table public.saves enable row level security;
revoke all on public.katana_catalog, public.gacha_tiers, public.finish_coins, public.saves from anon, authenticated;

-- ---------- 中身（ゲームの js/game.js と同じ値。tests/save-test.js で一致を確かめている） ----------
insert into public.gacha_tiers (tier, weight, dup_back) values
  ('並', 60, 2), ('上', 28, 4), ('極', 10, 10), ('幻', 2, 30)
on conflict (tier) do update set weight = excluded.weight, dup_back = excluded.dup_back;

insert into public.finish_coins (finish, coins) values
  ('疾風', 3), ('先の先', 3), ('隙穿ち', 3),
  ('陽炎', 9), ('二の太刀', 9), ('止め', 9),
  ('死中活', 24), ('流転', 24), ('紙一重', 24), ('鏡返し', 24),
  ('明鏡止水', 60), ('一閃', 150)
on conflict (finish) do update set coins = excluded.coins;

-- 刀を足したときは、ここに1行足して、このファイルをもう一度実行する
insert into public.katana_catalog (id, tier) values
  -- KATANA-BEGIN
  ('mumei', '並'),
  ('nowaki', '並'),
  ('shigure', '並'),
  ('yamabuki', '並'),
  ('oborozuki', '上'),
  ('kokihi', '上'),
  ('seiran', '上'),
  ('kokushitsu', '極'),
  ('guren', '極'),
  ('kogarashi', '並'),
  ('usuzumi', '並'),
  ('wakatake', '並'),
  ('akane', '並'),
  ('tsuyukusa', '並'),
  ('haizakura', '並'),
  ('kuchiba', '並'),
  ('kuriume', '並'),
  ('ruri', '上'),
  ('fujinami', '上'),
  ('kohaku', '上'),
  ('suiren', '上'),
  ('tokiwa', '上'),
  ('shinonome', '上'),
  ('narukami', '極'),
  ('yasha', '極'),
  ('hakuro', '極'),
  ('shiden', '極'),
  ('mugen', '幻'),
  ('nichirin', '幻'),
  ('geppaku', '幻')
  -- KATANA-END
on conflict (id) do update set tier = excluded.tier;

-- ---------- 中で使う小さな処理（ゲームからは呼べない） ----------
-- 数を安全に取り出す（数でなければ 0、0〜上限におさめる）
create or replace function public.save_num(v jsonb, cap bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' then least(greatest(floor(v::text::numeric), 0), cap)::bigint else 0 end;
$$;

-- ゲームに返す形
create or replace function public.save_json(s public.saves) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('coins', s.coins, 'best', s.cpu_best, 'owned', s.owned, 'rec', s.rec, 'equip', s.equip,
    'imports', s.imports, 'cost', (select c.pull_cost from public.app_config c where c.id = 1));
$$;

-- 自分の行を（なければ作って）鍵をかけて取る
create or replace function public.save_lock() returns public.saves
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); s public.saves;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  insert into public.saves (id) values (me) on conflict (id) do nothing;
  select * into s from public.saves where id = me for update;
  return s;
end;
$$;

-- その刀を持っているか（無銘は誰でも持っている）
create or replace function public.save_has(s public.saves, k text) returns boolean
language sql immutable set search_path = '' as $$
  select k = 'mumei' or coalesce((s.owned ->> k)::numeric, 0) > 0;
$$;

-- ---------- ゲームから呼ぶ処理 ----------
-- 自分の持ち物を読む
create or replace function public.get_save() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.saves;
begin
  s := public.save_lock();
  return public.save_json(s);
end;
$$;

-- 端末に保存されていた記録をアカウントへ足す（端末ごとに1回。1つのアカウントへは5回まで）
-- 知らない刀・決着名は捨て、数は上限でおさえる
create or replace function public.import_local(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.saves;
  k text; v jsonb; f text; n jsonb; cur jsonb;
  eq jsonb;
begin
  s := public.save_lock();
  if s.imports >= 5 then raise exception 'このアカウントへの引っ越しは5回までです'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception '記録の形が正しくありません'; end if;
  if pg_column_size(p) > 60000 then raise exception '記録が大きすぎます'; end if;

  s.coins := least(s.coins + public.save_num(p -> 'coins', 100000), 10000000);
  s.cpu_best := greatest(s.cpu_best, public.save_num(p -> 'best', 1000));

  if jsonb_typeof(p -> 'owned') = 'object' then
    for k, v in select * from jsonb_each(p -> 'owned') loop
      if k <> 'mumei' and exists (select 1 from public.katana_catalog c where c.id = k) and public.save_num(v, 999) > 0 then
        s.owned := jsonb_set(s.owned, array[k], to_jsonb(least(coalesce((s.owned ->> k)::bigint, 0) + public.save_num(v, 999), 9999)));
      end if;
    end loop;
  end if;

  if jsonb_typeof(p -> 'rec') = 'object' then
    for k, v in select * from jsonb_each(p -> 'rec') loop
      continue when not exists (select 1 from public.katana_catalog c where c.id = k) or jsonb_typeof(v) <> 'object';
      cur := coalesce(s.rec -> k, '{}');
      for f, n in select * from jsonb_each(v) loop
        if exists (select 1 from public.finish_coins x where x.finish = f) and public.save_num(n, 100000) > 0 then
          cur := jsonb_set(cur, array[f], to_jsonb(coalesce((cur ->> f)::bigint, 0) + public.save_num(n, 100000)));
        end if;
      end loop;
      if cur <> '{}' then s.rec := jsonb_set(s.rec, array[k], cur); end if;
    end loop;
  end if;

  -- 持たせていた刀は、持っている刀なら引き継ぐ
  eq := p -> 'equip';
  if jsonb_typeof(eq) = 'array' and jsonb_array_length(eq) = 2
     and public.save_has(s, eq ->> 0) and public.save_has(s, eq ->> 1) then
    s.equip := jsonb_build_array(eq ->> 0, eq ->> 1);
  end if;

  update public.saves set coins = s.coins, cpu_best = s.cpu_best, owned = s.owned, rec = s.rec, equip = s.equip,
    imports = s.imports + 1, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s);
end;
$$;

-- 勝ったことを記録し、決着に応じた銭を足す（銭の額はサーバーが決める）
create or replace function public.record_win(p_finish text, p_katana text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.saves;
  c int; gain int; cap int; cur jsonb;
begin
  s := public.save_lock();
  select x.coins into c from public.finish_coins x where x.finish = p_finish;
  if c is null then raise exception 'その決着はありません'; end if;
  if not public.save_has(s, p_katana) then raise exception 'その刀を持っていません'; end if;

  -- 1分に30回より多い勝ちは受け付けない（1回の決着には数秒かかるので、ふつうは届かない）
  if s.win_min is null or s.win_min < now() - interval '1 minute' then s.win_min := now(); s.win_count := 0; end if;
  s.win_count := s.win_count + 1;
  if s.win_count > 30 then raise exception '勝ちの記録が多すぎます。少し待ってください'; end if;

  -- 1日の上限
  if s.coin_day is distinct from current_date then s.coin_day := current_date; s.day_coins := 0; end if;
  select x.day_coin_cap into cap from public.app_config x where x.id = 1;
  gain := greatest(0, least(c, coalesce(cap, 15000) - s.day_coins));

  cur := coalesce(s.rec -> p_katana, '{}');
  cur := jsonb_set(cur, array[p_finish], to_jsonb(coalesce((cur ->> p_finish)::bigint, 0) + 1));

  update public.saves set coins = s.coins + gain, rec = jsonb_set(s.rec, array[p_katana], cur),
    win_min = s.win_min, win_count = s.win_count, coin_day = s.coin_day, day_coins = s.day_coins + gain, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s) || jsonb_build_object('gained', gain);
end;
$$;

-- CPU戦の最高記録（上がるときだけ変わる）
create or replace function public.record_cpu_best(p_n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.saves;
begin
  s := public.save_lock();
  update public.saves set cpu_best = greatest(cpu_best, least(greatest(coalesce(p_n, 0), 0), 1000)), updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s);
end;
$$;

-- ガチャを引く。くじはサーバーが引き、銭を減らして刀を渡す
-- 返す got: [{ id, new }]（new = 初めての刀）、back: 重なって戻った銭
create or replace function public.pull_gacha(p_n int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.saves;
  cost int; total numeric; r numeric; t text; k text; had bigint; back int := 0;
  got jsonb := '[]';
  i int;
begin
  s := public.save_lock();
  if p_n is null or p_n < 1 or p_n > 1000 then raise exception '回数が正しくありません'; end if;
  select x.pull_cost into cost from public.app_config x where x.id = 1;
  if s.coins < p_n::bigint * cost then raise exception '銭が足りません。勝負に勝って銭を集めてください'; end if;
  -- 刀が1本もない階級はくじから外す
  select sum(g.weight) into total from public.gacha_tiers g
    where exists (select 1 from public.katana_catalog c where c.tier = g.tier and c.in_gacha);
  if coalesce(total, 0) <= 0 then raise exception '今はガチャを引けません'; end if;

  for i in 1..p_n loop
    r := random() * total; t := null;
    for t in select g.tier from public.gacha_tiers g
        where exists (select 1 from public.katana_catalog c where c.tier = g.tier and c.in_gacha)
        order by case g.tier when '並' then 1 when '上' then 2 when '極' then 3 else 4 end loop
      r := r - (select g.weight from public.gacha_tiers g where g.tier = t);
      exit when r <= 0;
    end loop;
    select c.id into k from public.katana_catalog c where c.tier = t and c.in_gacha order by random() limit 1;
    had := coalesce((s.owned ->> k)::bigint, 0);
    s.owned := jsonb_set(s.owned, array[k], to_jsonb(had + 1));
    if had > 0 then back := back + (select g.dup_back from public.gacha_tiers g where g.tier = t); end if;
    got := got || jsonb_build_array(jsonb_build_object('id', k, 'new', had = 0));
  end loop;

  update public.saves set coins = s.coins - p_n::bigint * cost + back, owned = s.owned, pulls = s.pulls + p_n, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s) || jsonb_build_object('got', got, 'back', back);
end;
$$;

-- 朱・藍に持たせる刀（持っている刀だけ）
create or replace function public.set_equip(p_a text, p_b text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.saves;
begin
  s := public.save_lock();
  if not (public.save_has(s, p_a) and public.save_has(s, p_b)) then raise exception 'その刀を持っていません'; end if;
  update public.saves set equip = jsonb_build_array(p_a, p_b), updated_at = now() where id = s.id returning * into s;
  return public.save_json(s);
end;
$$;

-- ---------- 関数を呼べる人 ----------
revoke execute on function
  public.save_num(jsonb, bigint), public.save_json(public.saves), public.save_lock(), public.save_has(public.saves, text),
  public.get_save(), public.import_local(jsonb), public.record_win(text, text), public.record_cpu_best(int),
  public.pull_gacha(int), public.set_equip(text, text)
  from public, anon, authenticated;
grant execute on function
  public.get_save(), public.import_local(jsonb), public.record_win(text, text), public.record_cpu_best(int),
  public.pull_gacha(int), public.set_equip(text, text)
  to authenticated;
