-- =====================================================================
-- 一閃 団体戦（カスタムマッチ）の設定
-- 先に schema.sql・save-data.sql・ranking.sql を実行してある前提です。
-- Supabase の「SQL Editor」にこのファイルの中身をすべて貼り付けて「Run」を押してください。
--
-- 何度実行しても大丈夫です。表を消したり作り直したりはしません。
-- 足りない表・列だけを作り、処理（関数）だけを最新にします。
-- 利用者の銭・刀・戦闘力・対戦の記録には一切さわりません。
--
-- しくみ:
--   * ホストが「部屋」を作り、赤・青（と観戦）に分かれる
--   * 試合は1つずつ。各試合は今までのオンライン対戦（matches の表）をそのまま使い、room_id で部屋とつなぐ
--   * 次に誰と誰が戦うかは、試合の結果が確定した瞬間にサーバーが決める（ずるができない）
--   * 団体戦の試合は戦闘力に数えない。銭はいつも通りもらえる
-- =====================================================================

-- ---------- 部屋 ----------
create table if not exists public.team_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),          -- 部屋番号（人に伝える用）
  host uuid not null references public.profiles(id) on delete cascade,
  rule text not null default 'taisho' check (rule in ('free', 'taisho', 'tournament', 'kachinuki')),
  to_win int not null default 2 check (to_win between 1 and 5),       -- 1試合の先取本数
  target int not null default 5 check (target between 1 and 30),     -- 自由戦: 先に何点取ったら勝ちか
  has_pass boolean not null default false,                            -- 合言葉があるか（中身は別の表）
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'done', 'closed')),
  state jsonb not null default '{}',                                  -- 進み具合（出る順・試合の記録・点数）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  host_seen_at timestamptz not null default now()
);
create index if not exists team_rooms_host on public.team_rooms (host, status);

-- 合言葉（だれにも読めない。照らし合わせは処理の中だけ）
create table if not exists public.team_room_pass (
  room_id uuid primary key references public.team_rooms(id) on delete cascade,
  pass text not null
);

-- 部屋にいる人
create table if not exists public.team_members (
  room_id uuid not null references public.team_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,                                                   -- フレンドでない人にも名前が見えるように写しておく
  team text not null default 'watch' check (team in ('red', 'blue', 'watch')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

-- 出る順（大将戦・勝ち抜き戦）。始まるまでは同じチームの人にしか見えない
create table if not exists public.team_lineups (
  room_id uuid not null references public.team_rooms(id) on delete cascade,
  team text not null check (team in ('red', 'blue')),
  slots uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (room_id, team)
);

-- 部屋への招待
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.team_rooms(id) on delete cascade,
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists team_invites_to on public.team_invites (to_id, created_at);

-- 対戦の表に「どの部屋の試合か」を足す（今までの試合は空のまま）
alter table public.matches add column if not exists room_id uuid references public.team_rooms(id) on delete set null;
create index if not exists matches_room on public.matches (room_id);

-- ---------- 行ごとの守り ----------
alter table public.team_rooms enable row level security;
alter table public.team_room_pass enable row level security;
alter table public.team_members enable row level security;
alter table public.team_lineups enable row level security;
alter table public.team_invites enable row level security;
revoke all on public.team_rooms, public.team_room_pass, public.team_members, public.team_lineups, public.team_invites from anon, authenticated;
grant select on public.team_rooms, public.team_members, public.team_lineups, public.team_invites to authenticated;

create or replace function public.team_is_member(r uuid, u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members m where m.room_id = r and m.user_id = u);
$$;
create or replace function public.team_is_friend(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships f where f.a = least(x, y) and f.b = greatest(x, y) and f.status = 'accepted');
$$;

drop policy if exists "team_rooms: 部屋の人とホストのフレンド" on public.team_rooms;
create policy "team_rooms: 部屋の人とホストのフレンド" on public.team_rooms for select to authenticated
  using (host = auth.uid() or public.team_is_member(id, auth.uid())
         or (status in ('lobby', 'playing') and public.team_is_friend(host, auth.uid())));

drop policy if exists "team_members: 同じ部屋の人" on public.team_members;
create policy "team_members: 同じ部屋の人" on public.team_members for select to authenticated
  using (public.team_is_member(room_id, auth.uid()));

drop policy if exists "team_lineups: 同じチーム（始まったら全員）" on public.team_lineups;
create policy "team_lineups: 同じチーム（始まったら全員）" on public.team_lineups for select to authenticated
  using (exists (select 1 from public.team_members m where m.room_id = team_lineups.room_id and m.user_id = auth.uid() and m.team = team_lineups.team)
         or exists (select 1 from public.team_rooms r where r.id = team_lineups.room_id and r.status <> 'lobby' and public.team_is_member(r.id, auth.uid())));

drop policy if exists "team_invites: 当事者だけ" on public.team_invites;
create policy "team_invites: 当事者だけ" on public.team_invites for select to authenticated
  using (auth.uid() in (from_id, to_id));

-- ---------- 小さな道具 ----------
create or replace function public.team_new_code() returns text
language plpgsql security definer set search_path = '' as $$
declare c text; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from public.team_rooms where code = c);
  end loop;
  return c;
end;
$$;

-- 寄合（オープンチャット）の募集を「しめ切り」にする（chat.sql が未実行なら何もしない）
create or replace function public.team_close_ads(r uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if to_regclass('public.chat_messages') is not null then
    execute 'update public.chat_messages set ref = ref || ''{"open":false}''::jsonb where kind = ''team'' and ref ->> ''room'' = $1'
      using r::text;
  end if;
exception when others then null;
end;
$$;

-- 部屋をぬける（中で使う）。ホストがぬけたら部屋を閉じる
create or replace function public.team_drop(r uuid, u uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare rm public.team_rooms;
begin
  select * into rm from public.team_rooms where id = r for update;
  if not found then return; end if;
  delete from public.team_members where room_id = r and user_id = u;
  if rm.host = u and rm.status <> 'closed' then
    update public.team_rooms set status = 'closed', updated_at = now() where id = r;
    perform public.team_close_ads(r);
  elsif rm.status = 'playing' then
    perform public.team_advance(r);   -- 待っていた相手がいなくなったときなど
  end if;
end;
$$;

-- 今いる部屋をすべてぬける（新しく作る・入るとき）
create or replace function public.team_drop_all(u uuid, keep uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  for r in select room_id from public.team_members where user_id = u and room_id is distinct from keep loop
    perform public.team_drop(r, u);
  end loop;
end;
$$;

-- 大将戦の役の名前（出る順 i は 0 から、全部で n 人）
create or replace function public.team_pos_name(i int, n int) returns text
language sql immutable set search_path = '' as $$
  select case
    when i = n - 1 then '大将'
    when n = 2 then '先鋒'
    when n = 3 then (array['先鋒', '中堅'])[i + 1]
    when n = 4 then (array['先鋒', '中堅', '副将'])[i + 1]
    when i = n - 2 then '副将'
    when i = n - 3 then '中堅'
    when i = 0 then '先鋒'
    when i = 1 then '次鋒'
    else (array['三', '四', '五', '六', '七', '八', '九'])[i - 1] || '鋒'
  end;
$$;

-- そのチームの人（入った順）
create or replace function public.team_list(r uuid, t text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id order by joined_at, user_id), '{}') from public.team_members where room_id = r and team = t;
$$;

-- 出る順を確かめる。だめなら入った順で作り直す
--   n: 枠の数。each: 全員1回ずつか（勝ち抜き）、それとも全員が1回以上（大将戦で人数が少ない側）
create or replace function public.team_fix_lineup(want uuid[], mem uuid[], n int) returns uuid[]
language plpgsql immutable set search_path = '' as $$
declare ok boolean := true; x uuid; out uuid[] := '{}'; i int;
begin
  if want is not null and coalesce(array_length(want, 1), 0) = n then
    foreach x in array want loop if not (x = any(mem)) then ok := false; end if; end loop;
    foreach x in array mem loop if not (x = any(want)) then ok := false; end if; end loop;
    if ok then return want; end if;
  end if;
  for i in 0..n - 1 loop out := out || mem[1 + i % array_length(mem, 1)]; end loop;
  return out;
end;
$$;

-- ---------- 進行（試合が終わるたびに次を決める） ----------
-- 次の試合を作る。st: 部屋の state、a/b: 赤（朱・p0）と青（藍・p1）、label: 画面に出す名前
create or replace function public.team_make_bout(r uuid, st jsonb, a uuid, b uuid, label text, pts int, extra jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rm public.team_rooms; mid uuid; seed int; ina boolean; inb boolean; cur jsonb;
begin
  select * into rm from public.team_rooms where id = r;
  ina := a is not null and public.team_is_member(r, a);
  inb := b is not null and public.team_is_member(r, b);
  cur := jsonb_build_object('n', coalesce(jsonb_array_length(st -> 'bouts'), 0) + 1, 'a', a, 'b', b, 'label', label, 'pts', pts, 'at', now())
         || coalesce(extra, '{}');
  if not ina or not inb then
    -- どちらかが部屋にいない → 不戦（いる方の勝ち）
    cur := cur || jsonb_build_object('st', 'done', 'w', case when ina then a when inb then b else a end, 'why', '不戦');
    return cur;
  end if;
  seed := floor(random() * 2147483647)::int;
  insert into public.matches (p0, p1, seed, room_id) values (a, b, seed, r) returning id into mid;
  return cur || jsonb_build_object('st', 'play', 'match', mid, 'seed', seed, 'to_win', rm.to_win);
end;
$$;

-- 勝ち負けを点数などに反映する
create or replace function public.team_apply(rm public.team_rooms, st jsonb, cur jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w uuid := (cur ->> 'w')::uuid; wt text; lt text; k int; rr int;
begin
  wt := case when w = (cur ->> 'a')::uuid then 'red' else 'blue' end;
  lt := case when wt = 'red' then 'blue' else 'red' end;
  if rm.rule = 'taisho' then
    if cur ? 'daihyo' then st := st || jsonb_build_object('winner', wt);
    else st := jsonb_set(st, array['score', wt], to_jsonb(coalesce((st #>> array['score', wt])::int, 0) + (cur ->> 'pts')::int)); end if;
  elsif rm.rule = 'kachinuki' then
    st := jsonb_set(st, array['idx', lt], to_jsonb((st #>> array['idx', lt])::int + 1));
  elsif rm.rule = 'free' then
    st := jsonb_set(st, array['score', wt], to_jsonb(coalesce((st #>> array['score', wt])::int, 0) + 1));
    st := st || jsonb_build_object('champ', jsonb_build_object('id', w, 'team', wt, 'wins',
            case when st #>> '{champ,id}' = w::text then coalesce((st #>> '{champ,wins}')::int, 0) + 1 else 1 end));
  elsif rm.rule = 'tournament' then
    rr := (cur ->> 'round')::int; k := (cur ->> 'slot')::int;
    st := jsonb_set(st, array['win', rr::text], coalesce(st #> array['win', rr::text], '{}') || jsonb_build_object(k::text, w::text));
  end if;
  return st;
end;
$$;

-- 決着がついたか調べ、ついていなければ次の試合を作る
create or replace function public.team_advance(r uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rm public.team_rooms; st jsonb; cur jsonb; plan jsonb; i int; n int; a uuid; b uuid;
  red uuid[]; blue uuid[]; ir int; ib int; hr jsonb; hb jsonb; champ jsonb; guard int := 0;
  rounds jsonb; wins jsonb; rr int; k int; x jsonb; y jsonb; nxt jsonb; done boolean;
begin
  select * into rm from public.team_rooms where id = r for update;
  if not found or rm.status <> 'playing' then return; end if;
  st := rm.state;
  loop
    guard := guard + 1; exit when guard > 40;
    cur := st -> 'cur';
    if cur is not null and jsonb_typeof(cur) = 'object' then
      if cur ->> 'st' in ('play', 'stop') then exit; end if;
      if cur ->> 'st' = 'done' then
        st := public.team_apply(rm, st, cur);
        st := jsonb_set(st, '{bouts}', coalesce(st -> 'bouts', '[]') || jsonb_build_array(cur));
        st := st - 'cur';
        continue;
      end if;
    end if;
    -- 決着の判定と、次の組み合わせ
    nxt := null;
    if st ? 'winner' then exit; end if;
    if rm.rule = 'taisho' then
      plan := st -> 'plan'; n := jsonb_array_length(plan); i := jsonb_array_length(coalesce(st -> 'bouts', '[]'));
      if i < n then
        nxt := public.team_make_bout(r, st, (plan -> i ->> 'a')::uuid, (plan -> i ->> 'b')::uuid, plan -> i ->> 'label', (plan -> i ->> 'pts')::int, null);
      elsif (st #>> '{score,red}')::int > (st #>> '{score,blue}')::int then st := st || '{"winner":"red"}';
      elsif (st #>> '{score,red}')::int < (st #>> '{score,blue}')::int then st := st || '{"winner":"blue"}';
      else
        nxt := public.team_make_bout(r, st, (plan -> (n - 1) ->> 'a')::uuid, (plan -> (n - 1) ->> 'b')::uuid, '代表戦', 0, '{"daihyo":true}');
      end if;
    elsif rm.rule = 'kachinuki' then
      ir := (st #>> '{idx,red}')::int; ib := (st #>> '{idx,blue}')::int;
      if ir >= jsonb_array_length(st #> '{order,red}') then st := st || '{"winner":"blue"}';
      elsif ib >= jsonb_array_length(st #> '{order,blue}') then st := st || '{"winner":"red"}';
      else
        nxt := public.team_make_bout(r, st, (st #>> array['order', 'red', ir::text])::uuid, (st #>> array['order', 'blue', ib::text])::uuid,
                 '赤 ' || (ir + 1) || '人目 対 青 ' || (ib + 1) || '人目', 1, jsonb_build_object('ir', ir, 'ib', ib));
      end if;
    elsif rm.rule = 'free' then
      if coalesce((st #>> '{score,red}')::int, 0) >= rm.target then st := st || '{"winner":"red"}';
      elsif coalesce((st #>> '{score,blue}')::int, 0) >= rm.target then st := st || '{"winner":"blue"}';
      else
        -- 部屋にいない人・チームを変えた人は挑戦の列から外す
        hr := coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(st #> '{hands,red}', '[]')) v
                        where exists (select 1 from public.team_members m where m.room_id = r and m.user_id = (v #>> '{}')::uuid and m.team = 'red')), '[]');
        hb := coalesce((select jsonb_agg(v) from jsonb_array_elements(coalesce(st #> '{hands,blue}', '[]')) v
                        where exists (select 1 from public.team_members m where m.room_id = r and m.user_id = (v #>> '{}')::uuid and m.team = 'blue')), '[]');
        champ := st -> 'champ';
        if champ is not null and not exists (select 1 from public.team_members m where m.room_id = r and m.user_id = (champ ->> 'id')::uuid and m.team = champ ->> 'team') then
          champ := null; st := st - 'champ';
        end if;
        if champ is null then
          if jsonb_array_length(hr) > 0 and jsonb_array_length(hb) > 0 then
            a := (hr ->> 0)::uuid; b := (hb ->> 0)::uuid; hr := hr - 0; hb := hb - 0;
            nxt := public.team_make_bout(r, st, a, b, '初陣', 1, null);
          end if;
        elsif champ ->> 'team' = 'red' and jsonb_array_length(hb) > 0 then
          b := (hb ->> 0)::uuid; hb := hb - 0;
          nxt := public.team_make_bout(r, st, (champ ->> 'id')::uuid, b, (champ ->> 'wins') || '人抜き 挑戦', 1, null);
        elsif champ ->> 'team' = 'blue' and jsonb_array_length(hr) > 0 then
          a := (hr ->> 0)::uuid; hr := hr - 0;
          nxt := public.team_make_bout(r, st, a, (champ ->> 'id')::uuid, (champ ->> 'wins') || '人抜き 挑戦', 1, null);
        end if;
        st := jsonb_set(st, '{hands}', jsonb_build_object('red', hr, 'blue', hb));
        if nxt is null then exit; end if;   -- 挑む人を待つ
      end if;
    elsif rm.rule = 'tournament' then
      rounds := st -> 'rounds'; wins := coalesce(st -> 'win', '{}');
      done := false;
      for rr in 0..jsonb_array_length(rounds) - 1 loop
        for k in 0..jsonb_array_length(rounds -> rr) / 2 - 1 loop
          if wins #> array[rr::text, k::text] is not null then continue; end if;
          x := rounds -> rr -> (2 * k); y := rounds -> rr -> (2 * k + 1);
          if jsonb_typeof(x) = 'null' or jsonb_typeof(y) = 'null' then
            -- 相手がいない（不戦勝）
            st := jsonb_set(st, array['win', rr::text], coalesce(st #> array['win', rr::text], '{}') ||
                    jsonb_build_object(k::text, case when jsonb_typeof(x) = 'null' then y else x end));
            done := true; exit;
          end if;
          nxt := public.team_make_bout(r, st, (x #>> '{}')::uuid, (y #>> '{}')::uuid,
                   case when jsonb_array_length(rounds -> rr) = 2 then '決勝' when jsonb_array_length(rounds -> rr) = 4 then '準決勝'
                        else (rr + 1) || '回戦' end, 1, jsonb_build_object('round', rr, 'slot', k));
          done := true; exit;
        end loop;
        if done then exit; end if;
        -- この回戦が全部終わった → 次の回戦を作る（まだなければ）
        if rr = jsonb_array_length(rounds) - 1 then
          if jsonb_array_length(rounds -> rr) = 2 then
            st := st || jsonb_build_object('winner', wins #>> array[rr::text, '0']); done := true; exit;
          end if;
          st := jsonb_set(st, '{rounds}', rounds || jsonb_build_array(
                  (select jsonb_agg(wins #> array[rr::text, j::text] order by j) from generate_series(0, jsonb_array_length(rounds -> rr) / 2 - 1) j)));
          done := true; exit;
        end if;
      end loop;
      if not done then exit; end if;
      if nxt is null then continue; end if;   -- 不戦勝や次の回戦を作ったら、もう一度見る
    end if;
    if nxt is null then exit; end if;
    st := st || jsonb_build_object('cur', nxt);
  end loop;
  if st ? 'winner' then
    update public.team_rooms set state = st, status = 'done', updated_at = now() where id = r;
  else
    update public.team_rooms set state = st, updated_at = now() where id = r;
  end if;
end;
$$;

-- 団体戦の試合が確定・無効・中断になったら、部屋を進める
create or replace function public.team_on_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rm public.team_rooms; cur jsonb; s jsonb; w uuid;
begin
  if new.room_id is null or new.status = old.status or new.status = 'playing' then return new; end if;
  select * into rm from public.team_rooms where id = new.room_id for update;
  if not found or rm.status <> 'playing' then return new; end if;
  cur := rm.state -> 'cur';
  if cur is null or cur ->> 'match' is distinct from new.id::text or cur ->> 'st' <> 'play' then return new; end if;
  if new.status = 'done' then
    s := new.result -> 's';
    if jsonb_typeof(s) = 'array' and (s ->> 0)::numeric <> (s ->> 1)::numeric then
      w := case when (s ->> 0)::numeric > (s ->> 1)::numeric then new.p0 else new.p1 end;
      cur := cur || jsonb_build_object('st', 'done', 'w', w, 's', s);
    else
      cur := cur || jsonb_build_object('st', 'stop', 'why', '勝ち負けがつきませんでした');
    end if;
  else
    cur := cur || jsonb_build_object('st', 'stop', 'why', case when new.status = 'void' then '二人の結果が食い違いました' else '通信が切れました' end);
  end if;
  update public.team_rooms set state = jsonb_set(state, '{cur}', cur), updated_at = now() where id = rm.id;
  perform public.team_advance(rm.id);
  return new;
exception when others then
  raise warning '団体戦を進められませんでした: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists matches_team on public.matches;
create trigger matches_team after update of status on public.matches
  for each row execute function public.team_on_match();

-- 団体戦の試合は戦闘力に数えない（ranking.sql の処理の前に止める）
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'matches_rating' and tgrelid = 'public.matches'::regclass) then
    drop trigger matches_rating on public.matches;
    create trigger matches_rating after update of status on public.matches
      for each row when (new.room_id is null) execute function public.rating_apply();
  end if;
end $$;

-- ---------- ゲームから呼ぶ処理 ----------
create or replace function public.team_me() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  return auth.uid();
end;
$$;

-- 部屋を作る
create or replace function public.team_create(p_rule text, p_to_win int, p_target int, p_pass text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); r uuid; nm text; pw text := nullif(trim(coalesce(p_pass, '')), '');
begin
  if p_rule not in ('free', 'taisho', 'tournament', 'kachinuki') then raise exception 'ルールが正しくありません'; end if;
  if p_to_win not between 1 and 5 then raise exception '先取本数は1〜5本です'; end if;
  if p_target not between 1 and 30 then raise exception '自由戦の点数は1〜30点です'; end if;
  if pw is not null and char_length(pw) > 16 then raise exception '合言葉は16文字までです'; end if;
  if exists (select 1 from public.team_rooms where host = me and created_at > now() - interval '5 seconds') then
    raise exception '少し待ってからもう一度作ってください';
  end if;
  select name into nm from public.profiles where id = me;
  perform public.team_drop_all(me, null);
  insert into public.team_rooms (code, host, rule, to_win, target, has_pass)
    values (public.team_new_code(), me, p_rule, p_to_win, p_target, pw is not null) returning id into r;
  if pw is not null then insert into public.team_room_pass values (r, pw); end if;
  insert into public.team_members (room_id, user_id, name, team) values (r, me, nm, 'red');
  return r;
end;
$$;

-- 部屋に入る。p_room（寄合・招待から）か p_code（部屋番号）のどちらかで。合言葉は招待された人には要らない
create or replace function public.team_join(p_room uuid, p_code text, p_pass text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; nm text; invited boolean; players int; total int; red int; blue int; t text;
begin
  if p_room is not null then select * into rm from public.team_rooms where id = p_room for update;
  else select * into rm from public.team_rooms where code = upper(trim(coalesce(p_code, ''))) for update; end if;
  if not found then raise exception 'その部屋は見つかりません'; end if;
  if public.team_is_member(rm.id, me) then return rm.id; end if;
  if rm.status in ('done', 'closed') then raise exception 'その部屋はもう閉じています'; end if;
  if rm.host_seen_at < now() - interval '3 minutes' then raise exception '部屋の主がいないようです'; end if;
  invited := exists (select 1 from public.team_invites where room_id = rm.id and to_id = me);
  if p_code is null and not invited and not public.team_is_friend(rm.host, me) then
    raise exception 'この部屋には、部屋の主のフレンドか招待された人だけが入れます';
  end if;
  if rm.has_pass and not invited then
    if p_pass is null or trim(p_pass) = '' then raise exception '合言葉が必要です'; end if;
    if not exists (select 1 from public.team_room_pass where room_id = rm.id and pass = trim(p_pass)) then raise exception '合言葉が違います'; end if;
  end if;
  select count(*) filter (where team <> 'watch'), count(*), count(*) filter (where team = 'red'), count(*) filter (where team = 'blue')
    into players, total, red, blue from public.team_members where room_id = rm.id;
  if total >= 16 then raise exception '部屋がいっぱいです'; end if;
  t := case when rm.status <> 'lobby' or players >= 10 then 'watch' when red <= blue then 'red' else 'blue' end;
  select name into nm from public.profiles where id = me;
  perform public.team_drop_all(me, rm.id);
  insert into public.team_members (room_id, user_id, name, team) values (rm.id, me, nm, t);
  update public.team_rooms set updated_at = now() where id = rm.id;
  return rm.id;
end;
$$;

-- 部屋をぬける
create or replace function public.team_leave(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin perform public.team_drop(p_room, public.team_me()); end;
$$;

-- 自分の部屋（読み直したとき用）
create or replace function public.team_current() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.room_id from public.team_members m join public.team_rooms r on r.id = m.room_id
  where m.user_id = auth.uid() and r.status <> 'closed' order by m.joined_at desc limit 1;
$$;

-- 部屋の主の便り（20秒ごと）
create or replace function public.team_heartbeat(p_room uuid) returns void
language sql security definer set search_path = '' as $$
  update public.team_rooms set host_seen_at = now() where id = p_room and host = auth.uid();
$$;

-- チームを変える（自分のことは自分で、ホストはだれでも）。始まる前だけ
create or replace function public.team_set_team(p_room uuid, p_user uuid, p_team text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; old text; players int;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found then raise exception 'その部屋は見つかりません'; end if;
  if p_user <> me and rm.host <> me then raise exception 'ほかの人のチームを変えられるのは部屋の主だけです'; end if;
  if p_team not in ('red', 'blue', 'watch') then raise exception 'チームが正しくありません'; end if;
  select team into old from public.team_members where room_id = p_room and user_id = p_user;
  if not found then raise exception 'その人は部屋にいません'; end if;
  if rm.status in ('done', 'closed') then raise exception 'この部屋はもう終わっています'; end if;
  if old = p_team then return; end if;
  if rm.status = 'playing' and rm.rule <> 'free' then raise exception '始まってからはチームを変えられません（自由戦だけ変えられます）'; end if;
  if old = 'watch' and p_team <> 'watch' then
    select count(*) into players from public.team_members where room_id = p_room and team <> 'watch';
    if players >= 10 then raise exception '戦う人は10人までです'; end if;
  end if;
  update public.team_members set team = p_team where room_id = p_room and user_id = p_user;
  if rm.status = 'playing' then perform public.team_advance(p_room); end if;
end;
$$;

-- ルール・本数・合言葉を変える（ホスト、始まる前だけ）。p_pass が null なら合言葉はそのまま、'' なら外す
create or replace function public.team_settings(p_room uuid, p_rule text, p_to_win int, p_target int, p_pass text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; pw text := trim(p_pass);
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.host <> me then raise exception '変えられるのは部屋の主だけです'; end if;
  if rm.status <> 'lobby' then raise exception '始まってからは変えられません'; end if;
  if p_rule not in ('free', 'taisho', 'tournament', 'kachinuki') then raise exception 'ルールが正しくありません'; end if;
  if p_to_win not between 1 and 5 then raise exception '先取本数は1〜5本です'; end if;
  if p_target not between 1 and 30 then raise exception '自由戦の点数は1〜30点です'; end if;
  if pw is not null and char_length(pw) > 16 then raise exception '合言葉は16文字までです'; end if;
  update public.team_rooms set rule = p_rule, to_win = p_to_win, target = p_target,
    has_pass = case when pw is null then has_pass else pw <> '' end, updated_at = now() where id = p_room;
  if pw is not null then
    delete from public.team_room_pass where room_id = p_room;
    if pw <> '' then insert into public.team_room_pass values (p_room, pw); end if;
  end if;
end;
$$;

-- 出る順を決める（そのチームの人だけ。始まる前だけ）
create or replace function public.team_set_lineup(p_room uuid, p_team text, p_slots uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; x uuid;
begin
  select * into rm from public.team_rooms where id = p_room;
  if not found then raise exception 'その部屋は見つかりません'; end if;
  if rm.status <> 'lobby' then raise exception '始まってからは変えられません'; end if;
  if not exists (select 1 from public.team_members where room_id = p_room and user_id = me and team = p_team) then
    raise exception '自分のチームの順番だけ変えられます';
  end if;
  if coalesce(array_length(p_slots, 1), 0) > 10 then raise exception '多すぎます'; end if;
  foreach x in array coalesce(p_slots, '{}') loop
    if not exists (select 1 from public.team_members where room_id = p_room and user_id = x and team = p_team) then
      raise exception 'チームにいない人が入っています';
    end if;
  end loop;
  insert into public.team_lineups (room_id, team, slots) values (p_room, p_team, coalesce(p_slots, '{}'))
    on conflict (room_id, team) do update set slots = excluded.slots, updated_at = now();
end;
$$;

-- 部屋から外す（ホスト）
create or replace function public.team_kick(p_room uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me();
begin
  if not exists (select 1 from public.team_rooms where id = p_room and host = me) then raise exception '部屋の主だけができます'; end if;
  if p_user = me then raise exception '自分は外せません'; end if;
  perform public.team_drop(p_room, p_user);
end;
$$;

-- フレンドを部屋に招待する（部屋にいる人ならだれでも）
create or replace function public.team_invite(p_room uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me();
begin
  if not public.team_is_member(p_room, me) then raise exception '部屋に入っていません'; end if;
  if not public.team_is_friend(me, p_to) then raise exception 'フレンドにだけ招待できます'; end if;
  if not exists (select 1 from public.team_rooms where id = p_room and status in ('lobby', 'playing')) then raise exception 'その部屋はもう閉じています'; end if;
  if exists (select 1 from public.team_invites where room_id = p_room and to_id = p_to and created_at > now() - interval '20 seconds') then
    raise exception 'さっき招待したばかりです';
  end if;
  delete from public.team_invites where created_at < now() - interval '1 day';
  insert into public.team_invites (room_id, from_id, to_id) values (p_room, me, p_to);
end;
$$;

-- はじめる（ホスト）
create or replace function public.team_start(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.team_me(); rm public.team_rooms; red uuid[]; blue uuid[]; n int; i int; st jsonb;
  lr uuid[]; lb uuid[]; plan jsonb := '[]'; ps uuid[]; sz int; seeds jsonb; names jsonb;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.host <> me then raise exception 'はじめられるのは部屋の主だけです'; end if;
  if rm.status <> 'lobby' then raise exception 'もう始まっています'; end if;
  red := public.team_list(p_room, 'red'); blue := public.team_list(p_room, 'blue');
  select coalesce(jsonb_object_agg(user_id, name), '{}') into names from public.team_members where room_id = p_room;
  st := jsonb_build_object('names', names, 'bouts', '[]'::jsonb, 'score', jsonb_build_object('red', 0, 'blue', 0), 'started', now());
  if rm.rule = 'tournament' then
    ps := red || blue;
    if coalesce(array_length(ps, 1), 0) < 2 then raise exception 'トーナメントは出る人が2人以上いるときにできます'; end if;
    select array_agg(x order by random()) into ps from unnest(ps) x;
    n := array_length(ps, 1); sz := 2; while sz < n loop sz := sz * 2; end loop;
    -- 不戦勝が同じ組に重ならないよう、偶数の場所から埋める
    seeds := (select jsonb_agg(null::text) from generate_series(1, sz));
    for i in 0..n - 1 loop
      seeds := jsonb_set(seeds, array[(case when i < sz / 2 then i * 2 else (i - sz / 2) * 2 + 1 end)::text], to_jsonb(ps[i + 1]::text));
    end loop;
    st := st || jsonb_build_object('rounds', jsonb_build_array(seeds), 'win', '{}'::jsonb);
  else
    if coalesce(array_length(red, 1), 0) < 1 or coalesce(array_length(blue, 1), 0) < 1 then
      raise exception '赤と青に1人以上ずつ必要です';
    end if;
    lr := (select slots from public.team_lineups where room_id = p_room and team = 'red');
    lb := (select slots from public.team_lineups where room_id = p_room and team = 'blue');
    if rm.rule = 'taisho' then
      n := greatest(array_length(red, 1), array_length(blue, 1));
      lr := public.team_fix_lineup(lr, red, n); lb := public.team_fix_lineup(lb, blue, n);
      for i in 0..n - 1 loop
        plan := plan || jsonb_build_object('a', lr[i + 1], 'b', lb[i + 1], 'label', public.team_pos_name(i, n), 'pts', case when i = n - 1 then 2 else 1 end);
      end loop;
      st := st || jsonb_build_object('plan', plan, 'order', jsonb_build_object('red', to_jsonb(lr), 'blue', to_jsonb(lb)));
    elsif rm.rule = 'kachinuki' then
      lr := public.team_fix_lineup(lr, red, array_length(red, 1)); lb := public.team_fix_lineup(lb, blue, array_length(blue, 1));
      st := st || jsonb_build_object('order', jsonb_build_object('red', to_jsonb(lr), 'blue', to_jsonb(lb)), 'idx', '{"red":0,"blue":0}'::jsonb);
    else
      st := st || jsonb_build_object('hands', '{"red":[],"blue":[]}'::jsonb);
    end if;
  end if;
  update public.team_rooms set status = 'playing', state = st, updated_at = now() where id = p_room;
  perform public.team_close_ads(p_room);
  perform public.team_advance(p_room);
end;
$$;

-- 自由戦: 挑む（手を挙げる）・やめる
create or replace function public.team_challenge(p_room uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; t text; h jsonb;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.status <> 'playing' or rm.rule <> 'free' then raise exception '今は挑めません'; end if;
  select team into t from public.team_members where room_id = p_room and user_id = me;
  if t is null or t = 'watch' then raise exception '赤か青のチームに入ってから挑んでください'; end if;
  h := coalesce(rm.state #> array['hands', t], '[]') - me::text;
  if p_on then
    if rm.state #>> '{champ,id}' = me::text then raise exception 'あなたは今、勝ち残っています'; end if;
    h := h || to_jsonb(me::text);
  end if;
  update public.team_rooms set state = jsonb_set(state, array['hands', t], h), updated_at = now() where id = p_room;
  perform public.team_advance(p_room);
end;
$$;

-- 止まった試合: もう一度やる（ホスト）
create or replace function public.team_redo(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; cur jsonb; nxt jsonb;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.host <> me then raise exception '部屋の主だけができます'; end if;
  cur := rm.state -> 'cur';
  if rm.status <> 'playing' or cur is null or cur ->> 'st' <> 'stop' then raise exception 'やり直す試合がありません'; end if;
  if cur ->> 'match' is not null then
    update public.matches set status = 'abandoned', ended_at = now() where id = (cur ->> 'match')::uuid and status = 'playing';
  end if;
  nxt := public.team_make_bout(p_room, rm.state - 'cur', (cur ->> 'a')::uuid, (cur ->> 'b')::uuid, cur ->> 'label', (cur ->> 'pts')::int,
           cur - array['n', 'a', 'b', 'label', 'pts', 'at', 'st', 'match', 'seed', 'to_win', 'why', 'w', 's']);
  update public.team_rooms set state = jsonb_set(state, '{cur}', nxt), updated_at = now() where id = p_room;
  perform public.team_advance(p_room);
end;
$$;

-- 試合を負けにする（ホスト。止まった試合や、来ない人がいるとき）
create or replace function public.team_forfeit(p_room uuid, p_loser uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; cur jsonb; w uuid;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.host <> me then raise exception '部屋の主だけができます'; end if;
  cur := rm.state -> 'cur';
  if rm.status <> 'playing' or cur is null or cur ->> 'st' not in ('stop', 'play') then raise exception '今の試合がありません'; end if;
  if p_loser::text = cur ->> 'a' then w := (cur ->> 'b')::uuid;
  elsif p_loser::text = cur ->> 'b' then w := (cur ->> 'a')::uuid;
  else raise exception 'その人は今の試合に出ていません'; end if;
  update public.team_rooms set state = jsonb_set(state, '{cur}', cur || jsonb_build_object('st', 'done', 'w', w, 'why', '不戦')), updated_at = now()
    where id = p_room;
  if cur ->> 'match' is not null then
    update public.matches set status = 'abandoned', ended_at = now() where id = (cur ->> 'match')::uuid and status = 'playing';
  end if;
  perform public.team_advance(p_room);
end;
$$;

-- 終わらせる（ホスト）。自由戦は今の点数で勝敗を決める。ほかのルールは勝敗なしで終わる
create or replace function public.team_finish(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms; st jsonb; rs int; bs int;
begin
  select * into rm from public.team_rooms where id = p_room for update;
  if not found or rm.host <> me then raise exception '部屋の主だけができます'; end if;
  if rm.status <> 'playing' then raise exception '試合中ではありません'; end if;
  st := rm.state;
  if st -> 'cur' ->> 'match' is not null then
    update public.matches set status = 'abandoned', ended_at = now() where id = (st -> 'cur' ->> 'match')::uuid and status = 'playing';
  end if;
  st := st - 'cur';
  rs := coalesce((st #>> '{score,red}')::int, 0); bs := coalesce((st #>> '{score,blue}')::int, 0);
  st := st || jsonb_build_object('winner', case when rm.rule = 'free' and rs > bs then 'red' when rm.rule = 'free' and bs > rs then 'blue' else 'draw' end,
                                 'ended_by_host', true);
  update public.team_rooms set state = st, status = 'done', updated_at = now() where id = p_room;
end;
$$;

-- もう一度（ホスト）。同じ顔ぶれで部屋を始める前に戻す
create or replace function public.team_again(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me();
begin
  update public.team_rooms set status = 'lobby', state = '{}', updated_at = now(), host_seen_at = now()
    where id = p_room and host = me and status = 'done';
  if not found then raise exception 'もう一度はできません'; end if;
end;
$$;

-- 解散（ホスト）
create or replace function public.team_close(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.team_me(); cur jsonb;
begin
  select state -> 'cur' into cur from public.team_rooms where id = p_room and host = me;
  if not found then raise exception '部屋の主だけができます'; end if;
  if cur ->> 'match' is not null then
    update public.matches set status = 'abandoned', ended_at = now() where id = (cur ->> 'match')::uuid and status = 'playing';
  end if;
  update public.team_rooms set status = 'closed', updated_at = now() where id = p_room;
  perform public.team_close_ads(p_room);
end;
$$;

-- 寄合・招待で見せる部屋の様子（入る前でも、ホストのフレンドか招待された人なら見られる）
create or replace function public.team_peek(p_room uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := public.team_me(); rm public.team_rooms;
begin
  select * into rm from public.team_rooms where id = p_room;
  if not found then return null; end if;
  if not (public.team_is_member(rm.id, me) or public.team_is_friend(rm.host, me)
          or exists (select 1 from public.team_invites where room_id = rm.id and to_id = me)) then return null; end if;
  return jsonb_build_object('id', rm.id, 'rule', rm.rule, 'status', rm.status, 'has_pass', rm.has_pass,
    'host', (select name from public.team_members where room_id = rm.id and user_id = rm.host),
    'n', (select count(*) from public.team_members where room_id = rm.id),
    'invited', exists (select 1 from public.team_invites where room_id = rm.id and to_id = me));
end;
$$;

-- ---------- 関数を呼べる人 ----------
revoke execute on function
  public.team_is_member(uuid, uuid), public.team_is_friend(uuid, uuid), public.team_new_code(), public.team_close_ads(uuid),
  public.team_drop(uuid, uuid), public.team_drop_all(uuid, uuid), public.team_pos_name(int, int), public.team_list(uuid, text),
  public.team_fix_lineup(uuid[], uuid[], int), public.team_make_bout(uuid, jsonb, uuid, uuid, text, int, jsonb),
  public.team_apply(public.team_rooms, jsonb, jsonb), public.team_advance(uuid), public.team_on_match(), public.team_me(),
  public.team_create(text, int, int, text), public.team_join(uuid, text, text), public.team_leave(uuid), public.team_current(),
  public.team_heartbeat(uuid), public.team_set_team(uuid, uuid, text), public.team_settings(uuid, text, int, int, text),
  public.team_set_lineup(uuid, text, uuid[]), public.team_kick(uuid, uuid), public.team_invite(uuid, uuid), public.team_start(uuid),
  public.team_challenge(uuid, boolean), public.team_redo(uuid), public.team_forfeit(uuid, uuid), public.team_finish(uuid),
  public.team_again(uuid), public.team_close(uuid), public.team_peek(uuid)
  from public, anon, authenticated;
grant execute on function
  public.team_is_member(uuid, uuid), public.team_is_friend(uuid, uuid), public.team_me(),
  public.team_create(text, int, int, text), public.team_join(uuid, text, text), public.team_leave(uuid), public.team_current(),
  public.team_heartbeat(uuid), public.team_set_team(uuid, uuid, text), public.team_settings(uuid, text, int, int, text),
  public.team_set_lineup(uuid, text, uuid[]), public.team_kick(uuid, uuid), public.team_invite(uuid, uuid), public.team_start(uuid),
  public.team_challenge(uuid, boolean), public.team_redo(uuid), public.team_forfeit(uuid, uuid), public.team_finish(uuid),
  public.team_again(uuid), public.team_close(uuid), public.team_peek(uuid), public.team_pos_name(int, int)
  to authenticated;

-- ---------- リアルタイム ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_rooms') then
    alter publication supabase_realtime add table public.team_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_members') then
    alter publication supabase_realtime add table public.team_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_lineups') then
    alter publication supabase_realtime add table public.team_lineups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_invites') then
    alter publication supabase_realtime add table public.team_invites;
  end if;
end $$;

-- 非公開チャンネルの守り（schema.sql の決まりに足すだけ。あちらは変えない）
--   team:<部屋id>   … 部屋にいる人（部屋の様子の知らせ・部屋の中の一言）
--   tuser:<自分のid> … 自分あての部屋の招待
--   match:<対戦id>  … 団体戦の試合なら、同じ部屋の人が観戦できる（読むだけ）
create or replace function public.team_can_use_topic(t text, w boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare u uuid := auth.uid(); x uuid;
begin
  if u is null then return false; end if;
  if t = 'tuser:' || u::text then return true; end if;
  if t like 'team:%' then
    begin x := substr(t, 6)::uuid; exception when others then return false; end;
    return public.team_is_member(x, u);
  end if;
  if t like 'match:%' and not w then
    begin x := substr(t, 7)::uuid; exception when others then return false; end;
    return exists (select 1 from public.matches m where m.id = x and m.room_id is not null and m.status = 'playing'
                   and public.team_is_member(m.room_id, u));
  end if;
  return false;
end;
$$;
grant execute on function public.team_can_use_topic(text, boolean) to authenticated;

drop policy if exists "issen 団体戦: 読む" on realtime.messages;
create policy "issen 団体戦: 読む" on realtime.messages for select to authenticated
  using (public.team_can_use_topic(realtime.topic(), false));
drop policy if exists "issen 団体戦: 送る" on realtime.messages;
create policy "issen 団体戦: 送る" on realtime.messages for insert to authenticated
  with check (public.team_can_use_topic(realtime.topic(), true));
