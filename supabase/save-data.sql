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
  tier text not null check (tier in ('並', '上', '極', '幻', '絶')),
  in_gacha boolean not null default true,
  added_at timestamptz not null default now()
);

-- ---------- ガチャの箱（2026-11-27） ----------
-- 刀は箱ごとに分かれ、引くときは箱を選ぶ。絶はその箱の目玉で、その箱でしか出ない
-- 絶の割合: いちばん新しい箱は z_new（ふつう0.3%）、新しい箱が出たら古い箱は z_old（0.1%）
-- 第一弾はリリース記念で z_new = 0.5%（次の箱が出るまで）。並は残り（100 − 上・極・幻 − 絶）
-- 「いちばん新しい箱」= ガチャに入っている刀がある箱のうち、ord が一番大きい箱
create table if not exists public.gacha_boxes (
  id text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  ord int not null,                                         -- 出た順（1 = 第一弾）
  mei text not null,                                        -- 箱の名前
  pick text,                                                -- 目玉の絶の刀id
  z_new numeric not null default 0.3 check (z_new >= 0),    -- いちばん新しい箱のときの絶（%）
  z_old numeric not null default 0.1 check (z_old >= 0),    -- 古くなってからの絶（%）
  added_at timestamptz not null default now()
);

-- ---------- ガチャの確率と、重なったときに戻る銭 ----------
create table if not exists public.gacha_tiers (
  tier text primary key check (tier in ('並', '上', '極', '幻', '絶')),
  weight numeric not null check (weight >= 0),   -- 割合（%）
  dup_back int not null check (dup_back >= 0)    -- 持っている刀が出たときに戻る銭
);

-- ---------- 決着ごとにもらえる銭 ----------
create table if not exists public.finish_coins (
  finish text primary key,
  coins int not null check (coins >= 0)
);

-- 階級「絶」（2026-11-26）: 前に作った表の決まり（並・上・極・幻だけ）を、絶も入れられるように付け替える
alter table public.katana_catalog drop constraint if exists katana_catalog_tier_check;
alter table public.katana_catalog add constraint katana_catalog_tier_check check (tier in ('並', '上', '極', '幻', '絶'));
alter table public.gacha_tiers drop constraint if exists gacha_tiers_tier_check;
alter table public.gacha_tiers add constraint gacha_tiers_tier_check check (tier in ('並', '上', '極', '幻', '絶'));

-- 玉鋼（2026-11-26）: 持っている刀が出たら銭の代わりに玉鋼になり、玉鋼でまだ持っていない刀を鍛えられる
alter table public.gacha_tiers add column if not exists steel int not null default 0 check (steel >= 0);         -- 持っている刀が出たときの玉鋼
alter table public.gacha_tiers add column if not exists forge_cost int not null default 0 check (forge_cost >= 0); -- その階級の刀を鍛える玉鋼

-- ---------- 設定（schema.sql の app_config に列を足す） ----------
alter table public.app_config add column if not exists pull_cost int not null default 10;        -- ガチャ1回の銭
alter table public.app_config add column if not exists day_coin_cap int not null default 0;  -- 1日に勝負で得られる銭の上限（0 = 上限なし。ずる対策で戻すときは数を入れる）
alter table public.app_config alter column day_coin_cap set default 0;
update public.app_config set day_coin_cap = 0 where day_coin_cap in (5000, 15000);  -- 2026-11-27 上限を外す（1分30勝までの守りは残す）
alter table public.app_config add column if not exists vs_coin_div int not null default 3 check (vs_coin_div >= 1);  -- 同じ端末の二人対戦は銭をこの数で割る（2026-11-27、一人で両方を操作する銭稼ぎ対策）

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
  steel bigint not null default 0 check (steel >= 0),    -- 玉鋼
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saves add column if not exists steel bigint not null default 0 check (steel >= 0);
alter table public.saves add column if not exists forges int not null default 0;   -- 鍛えた回数

-- ---------- 運営アカウント（2026-11-26） ----------
-- ここに入っている人だけ、ガチャで銭が減らず、ピックアップ（選んだ刀が必ず出る）で引ける
create table if not exists public.god_accounts (
  id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.god_accounts enable row level security;
revoke all on public.god_accounts from anon, authenticated;

alter table public.gacha_boxes enable row level security;
alter table public.katana_catalog enable row level security;
alter table public.gacha_tiers enable row level security;
alter table public.finish_coins enable row level security;
alter table public.saves enable row level security;
revoke all on public.gacha_boxes, public.katana_catalog, public.gacha_tiers, public.finish_coins, public.saves from anon, authenticated;

-- ---------- 中身（ゲームの js/game.js と同じ値。tests/save-values-test.js で一致を確かめている） ----------
-- 割合(%)・重なって戻る銭(今は0。玉鋼に置きかえた)・重なったときの玉鋼・鍛える玉鋼
-- 並と絶の割合は箱で決まるので 0 にしてある（並は残り、絶は gacha_boxes の z_new / z_old）
insert into public.gacha_tiers (tier, weight, dup_back, steel, forge_cost) values
  ('並', 0, 0, 5, 50), ('上', 28, 0, 10, 110), ('極', 10, 0, 25, 300), ('幻', 2, 0, 100, 1500), ('絶', 0, 0, 300, 6000)
on conflict (tier) do update set weight = excluded.weight, dup_back = excluded.dup_back, steel = excluded.steel, forge_cost = excluded.forge_cost;

insert into public.finish_coins (finish, coins) values
  ('疾風', 3), ('先の先', 3), ('隙穿ち', 3),
  ('陽炎', 9), ('二の太刀', 9), ('止め', 9),
  ('死中活', 24), ('流転', 24), ('紙一重', 24), ('鏡返し', 24),
  ('明鏡止水', 60), ('一閃', 150),
  -- 新・一閃の決着（2026-11-26）
  ('斬り伏せ', 3), ('背水', 9), ('落花', 9), ('刹那', 9), ('百花', 24), ('散華', 150)
on conflict (finish) do update set coins = excluded.coins;

-- 箱（js/game.js の BOXES から node tools/katana-sql.js で作る）: id・出た順・名前・目玉の絶・新しいときの絶%・古いときの絶%
insert into public.gacha_boxes (id, ord, mei, pick, z_new, z_old) values
  -- BOXES-BEGIN
  ('b1', 1, '第一弾', 'ouka', 0.5, 0.1)
  -- BOXES-END
on conflict (id) do update set ord = excluded.ord, mei = excluded.mei, pick = excluded.pick, z_new = excluded.z_new, z_old = excluded.z_old;

-- 刀がどの箱に入っているか（前からある刀は第一弾 b1）
alter table public.katana_catalog add column if not exists box text not null default 'b1' references public.gacha_boxes(id);

-- 刀を足したときは js/game.js に足して node tools/katana-sql.js を実行し、このファイルをもう一度実行する
insert into public.katana_catalog (id, tier, box) values
  -- KATANA-BEGIN
  ('mumei', '並', 'b1'),
  ('nowaki', '並', 'b1'),
  ('shigure', '並', 'b1'),
  ('yamabuki', '並', 'b1'),
  ('oborozuki', '上', 'b1'),
  ('kokihi', '上', 'b1'),
  ('seiran', '上', 'b1'),
  ('kokushitsu', '極', 'b1'),
  ('guren', '極', 'b1'),
  ('kogarashi', '並', 'b1'),
  ('usuzumi', '並', 'b1'),
  ('wakatake', '並', 'b1'),
  ('akane', '並', 'b1'),
  ('tsuyukusa', '並', 'b1'),
  ('haizakura', '並', 'b1'),
  ('kuchiba', '並', 'b1'),
  ('kuriume', '並', 'b1'),
  ('ruri', '上', 'b1'),
  ('fujinami', '上', 'b1'),
  ('kohaku', '上', 'b1'),
  ('suiren', '上', 'b1'),
  ('tokiwa', '上', 'b1'),
  ('shinonome', '上', 'b1'),
  ('narukami', '極', 'b1'),
  ('yasha', '極', 'b1'),
  ('hakuro', '極', 'b1'),
  ('shiden', '極', 'b1'),
  ('mugen', '幻', 'b1'),
  ('nichirin', '幻', 'b1'),
  ('ouka', '絶', 'b1'),
  ('geppaku', '幻', 'b1')
  -- KATANA-END
on conflict (id) do update set tier = excluded.tier, box = excluded.box;

-- ---------- 中で使う小さな処理（ゲームからは呼べない） ----------
-- 数を安全に取り出す（数でなければ 0、0〜上限におさめる）
create or replace function public.save_num(v jsonb, cap bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' then least(greatest(floor(v::text::numeric), 0), cap)::bigint else 0 end;
$$;

-- ゲームに返す形
create or replace function public.save_json(s public.saves) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('coins', s.coins, 'steel', s.steel, 'best', s.cpu_best, 'owned', s.owned, 'rec', s.rec, 'equip', s.equip,
    'imports', s.imports, 'cost', (select c.pull_cost from public.app_config c where c.id = 1),
    'god', exists (select 1 from public.god_accounts g where g.id = s.id));
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
  s.steel := least(s.steel + public.save_num(p -> 'steel', 100000), 10000000);

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

  update public.saves set coins = s.coins, steel = s.steel, cpu_best = s.cpu_best, owned = s.owned, rec = s.rec, equip = s.equip,
    imports = s.imports + 1, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s);
end;
$$;

-- 勝ったことを記録し、決着に応じた銭を足す（銭の額はサーバーが決める）
-- p_mode: 'vs' = 同じ端末の二人対戦（銭は app_config.vs_coin_div 分の1、切り上げ）。なし = CPU戦・ネット対戦（そのまま）
drop function if exists public.record_win(text, text);
create or replace function public.record_win(p_finish text, p_katana text, p_mode text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.saves;
  c int; gain int; cap int; cur jsonb; dv int;
begin
  s := public.save_lock();
  select x.coins into c from public.finish_coins x where x.finish = p_finish;
  if c is null then raise exception 'その決着はありません'; end if;
  if p_mode = 'vs' then
    select x.vs_coin_div into dv from public.app_config x where x.id = 1;
    dv := greatest(coalesce(dv, 3), 1); c := (c + dv - 1) / dv;
  end if;
  if not public.save_has(s, p_katana) then raise exception 'その刀を持っていません'; end if;

  -- 1分に30回より多い勝ちは受け付けない（1回の決着には数秒かかるので、ふつうは届かない）
  if s.win_min is null or s.win_min < now() - interval '1 minute' then s.win_min := now(); s.win_count := 0; end if;
  s.win_count := s.win_count + 1;
  if s.win_count > 30 then raise exception '勝ちの記録が多すぎます。少し待ってください'; end if;

  -- 1日の上限（app_config.day_coin_cap が 0 以下なら上限なし。今日得た銭は数え続ける）
  if s.coin_day is distinct from current_date then s.coin_day := current_date; s.day_coins := 0; end if;
  select x.day_coin_cap into cap from public.app_config x where x.id = 1;
  if coalesce(cap, 0) <= 0 then gain := c; else gain := greatest(0, least(c, cap - s.day_coins)); end if;

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
-- p_box: 引く箱（なし = いちばん新しい箱）。その箱の刀だけが出て、絶はその箱の目玉
-- 運営アカウントは銭が減らず、p_pick に刀idを渡すとその刀が必ず出る（ほかの人が渡すと断る）
-- 返す got: [{ id, new, steel }]（new = 初めての刀、steel = 持っていた刀が変わった玉鋼）、back: 重なって戻った銭、steel_got: 玉鋼の合計、box: 引いた箱
drop function if exists public.pull_gacha(int);         -- 前の形を外す。p_n だけでも、p_pick までだけでも呼べる
drop function if exists public.pull_gacha(int, text);
create or replace function public.box_latest() returns text
language sql stable set search_path = '' as $$
  select b.id from public.gacha_boxes b
  where exists (select 1 from public.katana_catalog c where c.box = b.id and c.in_gacha)
  order by b.ord desc limit 1;
$$;
-- その箱の階級ごとの割合（刀が1本もない階級は出さない）
create or replace function public.box_rates(p_box text) returns table (tier text, weight numeric)
language sql stable set search_path = '' as $$
  with z as (
    select case when b.id = public.box_latest() then b.z_new else b.z_old end as z from public.gacha_boxes b where b.id = p_box
  ), w as (
    select g.tier, case g.tier
      when '絶' then (select z.z from z)
      when '並' then 100 - (select sum(x.weight) from public.gacha_tiers x where x.tier in ('上', '極', '幻')) - (select z.z from z)
      else g.weight end as weight
    from public.gacha_tiers g
  )
  select w.tier, w.weight from w
  where w.weight > 0 and exists (select 1 from public.katana_catalog c where c.box = p_box and c.tier = w.tier and c.in_gacha)
  order by case w.tier when '並' then 1 when '上' then 2 when '極' then 3 when '幻' then 4 else 5 end;
$$;
create or replace function public.pull_gacha(p_n int, p_pick text default null, p_box text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.saves;
  cost int; total numeric; r numeric; t text; k text; had bigint; back int := 0; st int; steel_got bigint := 0;
  got jsonb := '[]'; rates jsonb; e jsonb;
  i int; god boolean; bx text;
begin
  s := public.save_lock();
  if p_n is null or p_n < 1 or p_n > 1000 then raise exception '回数が正しくありません'; end if;
  god := exists (select 1 from public.god_accounts g where g.id = s.id);
  if p_pick is not null and not god then raise exception 'ピックアップは使えません'; end if;
  if p_pick is not null and not exists (select 1 from public.katana_catalog c where c.id = p_pick) then raise exception 'その刀はありません'; end if;
  bx := coalesce(p_box, public.box_latest());
  if bx is null or not exists (select 1 from public.katana_catalog c where c.box = bx and c.in_gacha) then raise exception 'その箱は引けません'; end if;
  select x.pull_cost into cost from public.app_config x where x.id = 1;
  if god then cost := 0; end if;
  if s.coins < p_n::bigint * cost then raise exception '銭が足りません。勝負に勝って銭を集めてください'; end if;
  select coalesce(jsonb_agg(jsonb_build_array(b.tier, b.weight)), '[]'), coalesce(sum(b.weight), 0) into rates, total from public.box_rates(bx) b;
  if total <= 0 then raise exception '今はガチャを引けません'; end if;

  for i in 1..p_n loop
    r := random() * total; t := null;
    for e in select * from jsonb_array_elements(rates) loop
      t := e ->> 0; r := r - (e ->> 1)::numeric;
      exit when r <= 0;
    end loop;
    select c.id into k from public.katana_catalog c where c.box = bx and c.tier = t and c.in_gacha order by random() limit 1;
    if p_pick is not null then k := p_pick; select c.tier into t from public.katana_catalog c where c.id = k; end if;
    had := coalesce((s.owned ->> k)::bigint, 0);
    s.owned := jsonb_set(s.owned, array[k], to_jsonb(had + 1));
    st := 0;
    if had > 0 then
      back := back + (select g.dup_back from public.gacha_tiers g where g.tier = t);
      st := (select g.steel from public.gacha_tiers g where g.tier = t);
      steel_got := steel_got + st;
    end if;
    got := got || jsonb_build_array(jsonb_build_object('id', k, 'new', had = 0, 'steel', st));
  end loop;

  update public.saves set coins = s.coins - p_n::bigint * cost + back, steel = least(s.steel + steel_got, 10000000),
    owned = s.owned, pulls = s.pulls + p_n, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s) || jsonb_build_object('got', got, 'back', back, 'steel_got', steel_got, 'box', bx);
end;
$$;

-- 玉鋼で刀を鍛える。まだ持っていない、ガチャに入っている刀だけ。玉鋼の額はサーバーが決める
create or replace function public.forge_katana(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.saves; t text; cost int;
begin
  s := public.save_lock();
  select c.tier into t from public.katana_catalog c where c.id = p_id and c.in_gacha;
  if t is null then raise exception 'その刀は鍛えられません'; end if;
  if public.save_has(s, p_id) then raise exception 'その刀はもう持っています'; end if;
  select g.forge_cost into cost from public.gacha_tiers g where g.tier = t;
  if cost is null or cost <= 0 then raise exception 'その刀は鍛えられません'; end if;
  if s.steel < cost then raise exception '玉鋼が足りません'; end if;
  update public.saves set steel = s.steel - cost, owned = jsonb_set(s.owned, array[p_id], to_jsonb(1)), forges = s.forges + 1, updated_at = now()
  where id = s.id returning * into s;
  return public.save_json(s) || jsonb_build_object('got', jsonb_build_array(jsonb_build_object('id', p_id, 'new', true)), 'spent', cost);
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

-- 絶の刀の持ち主（名前に「絶」の印を出すため）。自分とフレンド、それに p_ids で渡した人（対戦相手など、最大64人）のうち、
-- 絶の刀を1本でも持つ人の id を返す。返すのは「持っているか」だけで、銭や刀の中身は返さない
create or replace function public.zetsu_owners(p_ids uuid[] default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as id),
  people as (
    select m.id from me m where m.id is not null
    union
    select case when f.a = m.id then f.b else f.a end from public.friendships f, me m
      where m.id is not null and (f.a = m.id or f.b = m.id) and f.status = 'accepted'
    union
    select x from me m, unnest(coalesce(p_ids[1:64], '{}'::uuid[])) x where m.id is not null
  )
  select coalesce(jsonb_agg(s.id), '[]'::jsonb) from public.saves s join people p on p.id = s.id
  where exists (select 1 from jsonb_each(s.owned) o join public.katana_catalog c on c.id = o.key
                where c.tier = '絶' and jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0);
$$;
revoke execute on function public.zetsu_owners(uuid[]) from public, anon, authenticated;
grant execute on function public.zetsu_owners(uuid[]) to authenticated;

-- ---------- 関数を呼べる人 ----------
revoke execute on function
  public.save_num(jsonb, bigint), public.save_json(public.saves), public.save_lock(), public.save_has(public.saves, text),
  public.get_save(), public.import_local(jsonb), public.record_win(text, text, text), public.record_cpu_best(int),
  public.pull_gacha(int, text, text), public.set_equip(text, text), public.forge_katana(text),
  public.box_latest(), public.box_rates(text)
  from public, anon, authenticated;
grant execute on function
  public.get_save(), public.import_local(jsonb), public.record_win(text, text, text), public.record_cpu_best(int),
  public.pull_gacha(int, text, text), public.set_equip(text, text), public.forge_katana(text)
  to authenticated;
