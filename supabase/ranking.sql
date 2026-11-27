-- =====================================================================
-- 一閃 フレンド番付（ランキング）と対人の戦闘力
-- 先に schema.sql と save-data.sql を実行してある前提です。
-- Supabase の「SQL Editor」にこのファイルの中身をすべて貼り付けて「Run」を押してください。
--
-- 何度実行しても大丈夫です。表を消したり作り直したりはしません。
-- 足りない表だけを作り、処理（関数）と計算の数値だけを最新にします。
-- 利用者の戦闘力（ratings の表）と対戦の記録（rating_log の表）には一切さわりません。
--
-- 戦闘力の決まり方（数値は下の rating_config の表で変えられる）:
--   * はじめは 1000
--   * 勝つと増え、負けると減る。基本の幅は 32
--   * 格上に勝つほど大きく増え、格下に負けるほど大きく減る（同じくらいの相手なら ±16）
--       期待勝率 = 1 / (1 + 10^((相手 − 自分) / 400))
--       勝ち: +32 ×（1 − 期待勝率）× 連勝の倍率　　負け: −32 × 期待勝率
--   * 連勝の倍率: 1連勝目 ×1.0、そこから1勝ごとに +0.1、6連勝目以降は ×1.5
--   * 増減は最低 1。戦闘力は 100 より下がらない
--   * 同じ相手との対戦は、1日（日本時間）5戦まで戦闘力に数える（なれあいの水増し対策）
--
-- 守りの考え方:
--   * 戦闘力は、二人の結果報告が一致して確定した試合（matches.status = 'done'）からだけ、
--     サーバーが計算する。ゲームから戦闘力を書き込む処理はない
--   * 表は直接読めない（RLS で閉じる）。番付は下の処理で、自分とフレンドの分だけ返す
-- =====================================================================

-- ---------- 計算の数値 ----------
create table if not exists public.rating_config (
  id int primary key default 1 check (id = 1),
  start_rating int not null default 1000,        -- はじめの戦闘力
  k numeric not null default 32,                 -- 基本の幅
  scale numeric not null default 400,            -- 差がどれくらいで勝率が変わるか
  streak_step numeric not null default 0.1,      -- 連勝1回ごとの上乗せ
  streak_max numeric not null default 1.5,       -- 連勝の倍率の上限
  floor_rating int not null default 100,         -- これより下がらない
  pair_per_day int not null default 5            -- 同じ相手と1日に数える試合数
);
insert into public.rating_config (id) values (1) on conflict (id) do nothing;

-- ---------- 一人ひとりの戦闘力 ----------
create table if not exists public.ratings (
  id uuid primary key references public.profiles(id) on delete cascade,
  rating int not null default 1000,
  peak int not null default 1000,                -- これまでの最高
  wins int not null default 0,
  losses int not null default 0,
  streak int not null default 0,                 -- いまの連勝
  best_streak int not null default 0,            -- これまでの最高連勝
  updated_at timestamptz not null default now()
);

-- ---------- 試合ごとの増減の記録 ----------
create table if not exists public.rating_log (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  opp_id uuid not null references public.profiles(id) on delete cascade,
  won boolean not null,
  before int not null,
  after int not null,
  delta int not null,
  streak int not null,                           -- この試合の後の連勝
  counted boolean not null,                      -- false = 同じ相手との回数を超えたので数えなかった
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index if not exists rating_log_pair on public.rating_log (user_id, opp_id, created_at);

alter table public.rating_config enable row level security;
alter table public.ratings enable row level security;
alter table public.rating_log enable row level security;
revoke all on public.rating_config, public.ratings, public.rating_log from anon, authenticated;

-- ---------- 試合が確定したら、二人の戦闘力を動かす ----------
create or replace function public.rating_apply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  cfg public.rating_config;
  s jsonb; s0 numeric; s1 numeric;
  w uuid; l uuid;
  rw public.ratings; rl public.ratings;
  e numeric; mult numeric; gain int; loss int; n int; ok boolean;
  today_start timestamptz;
begin
  if new.status <> 'done' or old.status = 'done' then return new; end if;
  if (to_jsonb(new) ->> 'room_id') is not null then return new; end if;   -- 団体戦の試合は数えない（team.sql）
  if exists (select 1 from public.rating_log where match_id = new.id) then return new; end if;
  s := new.result -> 's';
  if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2
     or jsonb_typeof(s -> 0) <> 'number' or jsonb_typeof(s -> 1) <> 'number' then return new; end if;
  s0 := (s ->> 0)::numeric; s1 := (s ->> 1)::numeric;
  if s0 = s1 then return new; end if;                       -- 勝ち負けがない試合は数えない
  if s0 > s1 then w := new.p0; l := new.p1; else w := new.p1; l := new.p0; end if;

  select * into cfg from public.rating_config where id = 1;
  insert into public.ratings (id, rating, peak) values (w, cfg.start_rating, cfg.start_rating), (l, cfg.start_rating, cfg.start_rating)
    on conflict (id) do nothing;
  -- いつも同じ順で鍵をかける（同時に2つの試合が確定しても固まらない）
  perform 1 from public.ratings where id in (w, l) order by id for update;
  select * into rw from public.ratings where id = w;
  select * into rl from public.ratings where id = l;

  -- 同じ二人の今日（日本時間）の試合数
  today_start := (date_trunc('day', now() at time zone 'Asia/Tokyo')) at time zone 'Asia/Tokyo';
  select count(*) into n from public.rating_log x          -- 1試合に2行あるので、勝った側の行だけ数える
    where x.won and x.counted and x.created_at >= today_start
      and ((x.user_id = w and x.opp_id = l) or (x.user_id = l and x.opp_id = w));
  ok := n < cfg.pair_per_day;

  if ok then
    e := 1 / (1 + power(10::numeric, (rl.rating - rw.rating) / cfg.scale));   -- 勝った側の期待勝率
    mult := least(1 + cfg.streak_step * rw.streak, cfg.streak_max);
    gain := greatest(1, round(cfg.k * (1 - e) * mult))::int;
    loss := greatest(1, round(cfg.k * (1 - e)))::int;                        -- 負けた側の期待勝率 = 1 − e
    loss := least(loss, greatest(rl.rating - cfg.floor_rating, 0));
  else
    gain := 0; loss := 0;
  end if;

  insert into public.rating_log (match_id, user_id, opp_id, won, before, after, delta, streak, counted) values
    (new.id, w, l, true,  rw.rating, rw.rating + gain, gain,  case when ok then rw.streak + 1 else rw.streak end, ok),
    (new.id, l, w, false, rl.rating, rl.rating - loss, -loss, case when ok then 0 else rl.streak end, ok);

  update public.ratings set
    rating = rating + gain, peak = greatest(peak, rating + gain), wins = wins + 1,
    streak = case when ok then streak + 1 else streak end,
    best_streak = greatest(best_streak, case when ok then streak + 1 else streak end),
    updated_at = now()
  where id = w;
  update public.ratings set
    rating = rating - loss, losses = losses + 1,
    streak = case when ok then 0 else streak end,
    updated_at = now()
  where id = l;
  return new;
exception when others then
  -- 戦闘力の計算で何か起きても、試合の結果の記録は止めない
  raise warning '戦闘力を計算できませんでした: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists matches_rating on public.matches;
create trigger matches_rating after update of status on public.matches
  for each row execute function public.rating_apply();

-- ---------- ゲームから呼ぶ処理 ----------
-- この試合で自分の戦闘力がどう動いたか（結果の画面に出す）
create or replace function public.match_rating(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('before', r.before, 'after', r.after, 'delta', r.delta, 'streak', r.streak, 'counted', r.counted)
  from public.rating_log r where r.match_id = p_id and r.user_id = auth.uid();
$$;

-- 自分とフレンドの番付。三つの番付に使う値をまとめて返す
create or replace function public.friend_ranking() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  st int;
  total int;
  rows jsonb;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select c.start_rating into st from public.rating_config c where c.id = 1;
  select count(*) into total from public.katana_catalog;
  with people as (
    select me as id
    union
    select case when f.a = me then f.b else f.a end from public.friendships f
      where (f.a = me or f.b = me) and f.status = 'accepted'
        and not exists (select 1 from public.god_accounts g where g.id = case when f.a = me then f.b else f.a end)   -- 神様は番付に出さない
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', pr.name,
      'me', p.id = me,
      'cpu', coalesce(s.cpu_best, 0),
      'katana', 1 + coalesce((select count(*) from jsonb_each(s.owned) o
                               join public.katana_catalog c on c.id = o.key
                               where o.key <> 'mumei' and jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0), 0),
      'rating', coalesce(r.rating, st),
      'peak', coalesce(r.peak, st),
      'wins', coalesce(r.wins, 0),
      'losses', coalesce(r.losses, 0),
      'streak', coalesce(r.streak, 0),
      'best_streak', coalesce(r.best_streak, 0)
    )), '[]') into rows
  from people p
  join public.profiles pr on pr.id = p.id
  left join public.saves s on s.id = p.id
  left join public.ratings r on r.id = p.id;
  return jsonb_build_object('total', total, 'rows', rows);
end;
$$;

-- ---------- 関数を呼べる人 ----------
revoke execute on function public.rating_apply(), public.match_rating(uuid), public.friend_ranking() from public, anon, authenticated;
grant execute on function public.match_rating(uuid), public.friend_ranking() to authenticated;
