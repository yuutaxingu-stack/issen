-- =====================================================================
-- 一閃 名乗り（プロフィール）・文箱・お知らせ（2026-11-27）
-- 先に schema.sql・save-data.sql・ranking.sql を実行してある前提です。
-- Supabase の「SQL Editor」にこのファイルの中身をすべて貼り付けて「Run」を押してください。
-- 何度実行しても大丈夫です。表は消さず、足りない物だけ作り、処理（関数）と二つ名・背景の一覧だけを最新にします。
--
--   名乗り: 名前・二つ名・背景の札（プレート）・一言・好きな一振り。自分で選んで書き換える
--           二つ名と背景は「持っている物」から選ぶ。手に入れる道は文箱（運営からの贈り物）
--   文箱:   運営（神様アカウント）からの手紙。銭・玉鋼・二つ名・背景を添えられ、「受け取る」で入る
--   お知らせ: メンテナンス・大事なお知らせ・更新 の三種。ログインしていなくても読める
--
-- 守り: 表はどれもゲームから直接は読み書きできない（RLS で閉じる）。下の処理を通してだけ。
--       運営の処理（god_ で始まる）は god_accounts に入っている人だけが呼べる。
-- =====================================================================

-- ---------- 二つ名の一覧 ----------
create table if not exists public.title_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  name text not null check (char_length(name) between 1 and 12),
  note text not null default '',     -- 手に入れたわけ（名乗りの画面で、二つ名を触ると出る）
  ord int not null default 100
);

-- ---------- 背景の札（プレート）の一覧。絵は js/profile.js の PLATES で描く ----------
create table if not exists public.plate_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  name text not null check (char_length(name) between 1 and 12),
  note text not null default '',
  free boolean not null default false,   -- true なら誰でも使える
  ord int not null default 100
);

-- その刀にまつわる二つ名・背景（その刀の箱が公開されるまで、神様と持っている人以外には図鑑で見せない。2026-11-27）
alter table public.title_catalog add column if not exists katana text;
alter table public.plate_catalog add column if not exists katana text;

-- ---------- 一人ひとりの名乗り ----------
create table if not exists public.profile_ext (
  id uuid primary key references public.profiles(id) on delete cascade,
  word text not null default '' check (char_length(word) <= 30),   -- 一言
  fav text,                                                        -- 好きな一振り（刀id）
  title text references public.title_catalog(id),                 -- 名乗っている二つ名
  plate text references public.plate_catalog(id),                 -- 使っている背景
  titles text[] not null default '{}',                             -- 持っている二つ名
  plates text[] not null default '{}',                             -- 持っている背景（誰でも使える物は入れない）
  updated_at timestamptz not null default now()
);

-- ---------- 文箱 ----------
-- gifts: { coins, steel, titles: [二つ名id], plates: [背景id] }
create table if not exists public.mail (
  id bigint generated always as identity primary key,
  to_id uuid not null references public.profiles(id) on delete cascade,
  batch uuid not null,                                   -- 一斉に送った手紙は同じ batch
  subject text not null check (char_length(subject) between 1 and 40),
  body text not null default '' check (char_length(body) <= 600),
  gifts jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  claimed_at timestamptz
);
create index if not exists mail_to on public.mail (to_id, id desc);

-- ---------- お知らせ ----------
create table if not exists public.notices (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('maint', 'important', 'update')),   -- メンテナンス・大事なお知らせ・更新
  title text not null check (char_length(title) between 1 and 40),
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
-- 特別なお知らせ（2026-11-27）: 看板に絶の刀の抜刀演出を流す。art = 刀の id（例 'yata'）
alter table public.notices add column if not exists art text check (art is null or art ~ '^[a-z0-9_]{1,32}$');
alter table public.notices drop constraint if exists notices_kind_check;
alter table public.notices add constraint notices_kind_check check (kind in ('maint', 'important', 'update', 'special'));

alter table public.title_catalog enable row level security;
alter table public.plate_catalog enable row level security;
alter table public.profile_ext enable row level security;
alter table public.mail enable row level security;
alter table public.notices enable row level security;
revoke all on public.title_catalog, public.plate_catalog, public.profile_ext, public.mail, public.notices from anon, authenticated;

-- ---------- 中身（名前とわけはここを書き換えて、もう一度実行すれば変わる） ----------
-- style: 見た目。'' = 朱の帯、'zetsu' = 絶の赤黒（css/profile.css の .pfnick.s-zetsu）
alter table public.title_catalog add column if not exists style text not null default '';
-- 'yata' = 八咫の白と黒
insert into public.title_catalog (id, name, note, style, ord, katana) values
  ('issen', '一閃', '後のない刹那に、明鏡止水を決めた者', '', 2, null),
  ('issen_ouka', '桜華一閃', '絶の一振り「桜華」で、一閃を決めた者', 'zetsu', 1, 'ouka'),
  ('issen_yata', '八咫一閃', '絶の一振り「八咫」で、一閃を決めた者', 'yata', 1, 'yata')
on conflict (id) do update set name = excluded.name, note = excluded.note, style = excluded.style, ord = excluded.ord, katana = excluded.katana;

insert into public.plate_catalog (id, name, note, free, ord, katana) values
  ('sumi',  '墨',   'はじめから使える', true, 1, null),
  ('take',  '竹林', 'はじめから使える', true, 2, null),
  ('tsuki', '月夜', 'はじめから使える', true, 3, null),
  ('ouka',  '桜華', '絶の一振り「桜華」を手にした者', false, 50, 'ouka'),
  ('yata',  '八咫', '絶の一振り「八咫」を手にした者', false, 51, 'yata')
on conflict (id) do update set name = excluded.name, note = excluded.note, free = excluded.free, ord = excluded.ord, katana = excluded.katana;

-- ---------- 中で使う小さな処理 ----------
create or replace function public.is_god(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and exists (select 1 from public.god_accounts g where g.id = u);
$$;

-- その人の名乗り（他の人が見てよいものだけ）
create or replace function public.profile_json(p uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', pr.id,
    'name', pr.name,
    'word', coalesce(x.word, ''),
    'fav', x.fav,
    'title', x.title,
    'title_name', t.name,
    'title_style', t.style,
    'title_note', t.note,
    'plate', coalesce(x.plate, 'sumi'),
    'rating', coalesce(r.rating, (select c.start_rating from public.rating_config c where c.id = 1), 1000),
    'peak', coalesce(r.peak, 1000),
    'wins', coalesce(r.wins, 0),
    'losses', coalesce(r.losses, 0),
    'cpu', coalesce(s.cpu_best, 0),
    'katana', 1 + coalesce((select count(*) from jsonb_each(s.owned) o join public.katana_catalog c on c.id = o.key
                             where o.key <> 'mumei' and jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0), 0),
    'total', (select count(*) from public.katana_catalog),
    'issen', coalesce((select sum(case when jsonb_typeof(v.value -> '一閃') = 'number' then (v.value ->> '一閃')::numeric else 0 end)
                        from jsonb_each(s.rec) v where jsonb_typeof(v.value) = 'object'), 0),
    'zetsu', exists (select 1 from jsonb_each(s.owned) o join public.katana_catalog c on c.id = o.key
                     where c.tier = '絶' and jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0),
    'since', pr.created_at
  )
  from public.profiles pr
  left join public.profile_ext x on x.id = pr.id
  left join public.title_catalog t on t.id = x.title
  left join public.ratings r on r.id = pr.id
  left join public.saves s on s.id = pr.id
  where pr.id = p;
$$;

-- 一閃を決めたことがあるか（刀ごとの戦績に「一閃」が1回以上）
create or replace function public.has_issen(s public.saves) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_each(s.rec) v
                 where jsonb_typeof(v.value) = 'object' and jsonb_typeof(v.value -> '一閃') = 'number' and (v.value ->> '一閃')::numeric > 0);
$$;

-- ---------- 名乗り ----------
-- 誰の名乗りでも見られる（id を知っている人だけ。id は番付・寄合・団体戦などで目にする相手）
create or replace function public.get_profile(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); j jsonb; x public.profile_ext; g boolean := public.is_god(auth.uid());
begin
  if me is null then raise exception 'ログインしていません'; end if;
  j := public.profile_json(coalesce(p_id, me));
  if j is null then raise exception 'その人は見つかりません'; end if;
  if coalesce(p_id, me) = me then
    -- 自分なら、選べる二つ名・背景も返す
    select * into x from public.profile_ext e where e.id = me;
    j := j || jsonb_build_object('me', true,
      'my_titles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'note', t.note, 'style', t.style) order by t.ord, t.id)
                             from public.title_catalog t where g or t.id = any(coalesce(x.titles, '{}'))), '[]'),
      'my_plates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'note', p.note) order by p.ord, p.id)
                             from public.plate_catalog p where g or p.free or p.id = any(coalesce(x.plates, '{}'))), '[]'));
  end if;
  return j;
end;
$$;

-- 名前の横に添える二つ名（番付などの一覧用。最大64人）
create or replace function public.profile_tags(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.id, jsonb_build_object('title', t.name, 'style', t.style, 'plate', x.plate)), '{}')
  from public.profile_ext x left join public.title_catalog t on t.id = x.title
  where auth.uid() is not null and x.id = any(coalesce(p_ids[1:64], '{}')) and (x.title is not null or x.plate is not null);
$$;

-- 自分の名乗りを書き換える。二つ名・背景は持っている物だけ、好きな一振りは持っている刀だけ
create or replace function public.set_profile(p_word text, p_fav text, p_title text, p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); x public.profile_ext; w text; g boolean := public.is_god(auth.uid());   -- 神様は二つ名・背景・刀を全部持っている
begin
  if me is null then raise exception 'ログインしていません'; end if;
  insert into public.profile_ext (id) values (me) on conflict (id) do nothing;
  select * into x from public.profile_ext e where e.id = me for update;
  w := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'));
  if char_length(w) > 30 then raise exception '一言は30文字までです'; end if;
  if public.link_blocked(me, w) then raise exception '一言にリンク（URL）は書き込めません'; end if;
  if p_fav is not null and p_fav <> 'mumei' and not g and not exists (
      select 1 from public.saves s where s.id = me and coalesce((s.owned ->> p_fav)::numeric, 0) > 0) then
    raise exception 'その刀を持っていません';
  end if;
  if p_title is not null and not (g and exists (select 1 from public.title_catalog t where t.id = p_title)) and not (p_title = any(x.titles)) then raise exception 'その二つ名は持っていません'; end if;
  if p_plate is not null and not (g and exists (select 1 from public.plate_catalog p where p.id = p_plate)) and not (p_plate = any(x.plates) or exists (select 1 from public.plate_catalog p where p.id = p_plate and p.free)) then
    raise exception 'その背景は持っていません';
  end if;
  update public.profile_ext set word = w, fav = p_fav, title = p_title, plate = p_plate, updated_at = now() where id = me;
  return public.get_profile(me);
end;
$$;

-- ---------- 文箱 ----------
-- 自分の文箱（新しい順に50通まで）。添え物の二つ名・背景には名前を付けて返す
create or replace function public.my_mail() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'ログインしていません'; end if;
  return jsonb_build_object(
    'unclaimed', (select count(*) from public.mail m where m.to_id = me and m.claimed_at is null and m.gifts <> '{}'),
    'unread', (select count(*) from public.mail m where m.to_id = me and m.read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'subject', m.subject, 'body', m.body, 'gifts', m.gifts,
        'title_names', (select coalesce(jsonb_agg(t.name), '[]') from public.title_catalog t
                         where jsonb_typeof(m.gifts -> 'titles') = 'array' and m.gifts -> 'titles' ? t.id),
        'plate_names', (select coalesce(jsonb_agg(p.name), '[]') from public.plate_catalog p
                         where jsonb_typeof(m.gifts -> 'plates') = 'array' and m.gifts -> 'plates' ? p.id),
        'at', m.created_at, 'read', m.read_at is not null, 'claimed', m.claimed_at is not null) order by m.id desc)
      from (select * from public.mail m where m.to_id = me order by m.id desc limit 50) m), '[]'));
end;
$$;

create or replace function public.read_mail(p_id bigint) returns void
language sql security definer set search_path = '' as $$
  update public.mail set read_at = now() where id = p_id and to_id = auth.uid() and read_at is null;
$$;

-- 受け取る（p_id = null なら、まだ受け取っていない手紙を全部）。銭・玉鋼は持ち物へ、二つ名・背景は名乗りへ
-- 返す: { save: 持ち物（save_json）, got: { coins, steel, titles: [名前], plates: [名前] }, n: 受け取った通数 }
create or replace function public.claim_mail(p_id bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); m public.mail; s public.saves;
  v_coins bigint := 0; v_steel bigint := 0; tl text[] := '{}'; pl text[] := '{}'; n int := 0; k text;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  s := public.save_lock();
  insert into public.profile_ext (id) values (me) on conflict (id) do nothing;
  perform 1 from public.profile_ext e where e.id = me for update;
  for m in select * from public.mail x where x.to_id = me and x.claimed_at is null and (p_id is null or x.id = p_id) order by x.id for update loop
    v_coins := v_coins + public.save_num(m.gifts -> 'coins', 1000000);
    v_steel := v_steel + public.save_num(m.gifts -> 'steel', 1000000);
    if jsonb_typeof(m.gifts -> 'titles') = 'array' then
      for k in select jsonb_array_elements_text(m.gifts -> 'titles') loop
        if exists (select 1 from public.title_catalog t where t.id = k) then tl := array_append(tl, k); end if;
      end loop;
    end if;
    if jsonb_typeof(m.gifts -> 'plates') = 'array' then
      for k in select jsonb_array_elements_text(m.gifts -> 'plates') loop
        if exists (select 1 from public.plate_catalog p where p.id = k) then pl := array_append(pl, k); end if;
      end loop;
    end if;
    update public.mail set claimed_at = now(), read_at = coalesce(read_at, now()) where id = m.id;
    n := n + 1;
  end loop;
  if p_id is not null and n = 0 then raise exception 'その手紙はもう受け取っています'; end if;
  if v_coins > 0 or v_steel > 0 then
    update public.saves set coins = least(s.coins + v_coins, 10000000), steel = least(s.steel + v_steel, 10000000), updated_at = now()
    where id = me returning * into s;
  end if;
  update public.profile_ext e set
    titles = (select coalesce(array_agg(distinct v), '{}') from unnest(e.titles || tl) v),
    plates = (select coalesce(array_agg(distinct v), '{}') from unnest(e.plates || pl) v),
        -- もらった二つ名が今の二つ名より上（ord が小さい）なら、そちらに名乗り替える
    title = coalesce((select t.id from public.title_catalog t where t.id = any(array_append(tl, e.title)) order by t.ord, t.id limit 1), e.title),
    updated_at = now()
  where e.id = me;
  return jsonb_build_object('save', public.save_json(s), 'n', n,
    'got', jsonb_build_object('coins', v_coins, 'steel', v_steel,
      'titles', (select coalesce(jsonb_agg(distinct t.name), '[]') from public.title_catalog t where t.id = any(tl)),
      'plates', (select coalesce(jsonb_agg(distinct p.name), '[]') from public.plate_catalog p where p.id = any(pl))));
end;
$$;

-- ---------- お知らせ（ログインしていなくても読める） ----------
create or replace function public.list_notices() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'at', n.created_at, 'art', n.art) order by n.id desc), '[]')
  from (select * from public.notices x where not x.deleted order by x.id desc limit 40) n;
$$;

-- ---------- 運営（神様アカウント）だけが使える処理 ----------
-- 宛先の選び方 p_target:
--   'all'    ログインしたことのある全員
--   'issen'  決着「一閃」を一度でも決めた人（刀ごとの戦績から割り出す）
--   'katana' p_arg の刀（例 'ouka'）を持っている人
--   'login'  p_arg の名前かログインID（カンマ・読点・空白で区切って何人でも）
create or replace function public.god_targets(p_target text, p_arg text) returns table (id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target = 'all' then
    return query select pr.id from public.profiles pr;
  elsif p_target = 'issen' then
    return query select s.id from public.saves s where public.has_issen(s);
  elsif p_target = 'katana' then
    if not exists (select 1 from public.katana_catalog c where c.id = p_arg) then raise exception 'その刀はありません'; end if;
    return query select s.id from public.saves s where coalesce((s.owned ->> p_arg)::numeric, 0) > 0 and not public.is_god(s.id);   -- 神様は全部持っているので外す
  elsif p_target = 'login' then
    return query select pr.id from public.profiles pr
      where exists (select 1 from regexp_split_to_table(coalesce(p_arg, ''), '[,、，\s　]+') v
                    where btrim(v) <> '' and (pr.login = lower(btrim(v)) or pr.name = btrim(v)));
  else
    raise exception '宛先の選び方が正しくありません';
  end if;
end;
$$;

-- 宛先を確かめる（送らない）。人数と、先頭30人の名前・ログインID
create or replace function public.god_preview(p_target text, p_arg text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  return jsonb_build_object(
    'n', (select count(*) from public.god_targets(p_target, p_arg)),
    'list', (select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'login', q.login)), '[]')
             from (select pr.name, pr.login from public.god_targets(p_target, p_arg) g join public.profiles pr on pr.id = g.id
                   order by pr.name limit 30) q));
end;
$$;

-- 一斉に手紙を送る。返すのは送った通数
create or replace function public.god_send_mail(p_target text, p_arg text, p_subject text, p_body text, p_gifts jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare g jsonb := '{}'; k text; b uuid := gen_random_uuid(); n int;
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  if char_length(btrim(coalesce(p_subject, ''))) = 0 then raise exception '題を書いてください'; end if;
  if jsonb_typeof(p_gifts) = 'object' then
    if public.save_num(p_gifts -> 'coins', 1000000) > 0 then g := g || jsonb_build_object('coins', public.save_num(p_gifts -> 'coins', 1000000)); end if;
    if public.save_num(p_gifts -> 'steel', 1000000) > 0 then g := g || jsonb_build_object('steel', public.save_num(p_gifts -> 'steel', 1000000)); end if;
    if jsonb_typeof(p_gifts -> 'titles') = 'array' and jsonb_array_length(p_gifts -> 'titles') > 0 then
      for k in select jsonb_array_elements_text(p_gifts -> 'titles') loop
        if not exists (select 1 from public.title_catalog t where t.id = k) then raise exception 'その二つ名はありません: %', k; end if;
      end loop;
      g := g || jsonb_build_object('titles', p_gifts -> 'titles');
    end if;
    if jsonb_typeof(p_gifts -> 'plates') = 'array' and jsonb_array_length(p_gifts -> 'plates') > 0 then
      for k in select jsonb_array_elements_text(p_gifts -> 'plates') loop
        if not exists (select 1 from public.plate_catalog p where p.id = k) then raise exception 'その背景はありません: %', k; end if;
      end loop;
      g := g || jsonb_build_object('plates', p_gifts -> 'plates');
    end if;
  end if;
  insert into public.mail (to_id, batch, subject, body, gifts)
    select t.id, b, btrim(p_subject), coalesce(p_body, ''), g from public.god_targets(p_target, p_arg) t;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 運営が見る: 送った手紙のまとまり（新しい順に20）と、二つ名・背景の一覧
create or replace function public.god_info() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  return jsonb_build_object(
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.ord, t.id), '[]') from public.title_catalog t
               where not t.hidden),   -- 隠し二つ名は手で送らない（一番の人だけが持つ）
    'crowns', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'note', t.note, 'holder', p.name, 'value', c.value, 'since', c.since) order by t.ord), '[]')
               from public.crowns c join public.title_catalog t on t.id = c.title left join public.profiles p on p.id = c.holder),
    'plates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'free', p.free) order by p.ord, p.id), '[]') from public.plate_catalog p),
    'auto', (select coalesce(jsonb_agg(jsonb_build_object('subject', a.subject, 'cond', a.cond, 'arg', a.arg, 'active', a.active,
               'n', (select count(*) from public.auto_gifts_given d where d.gift_id = a.id)) order by a.ord), '[]') from public.auto_gifts a),
    'sent', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]') from (
      select jsonb_build_object('batch', m.batch, 'subject', min(m.subject), 'at', min(m.created_at), 'n', count(*), 'claimed', count(m.claimed_at)) x
      from public.mail m group by m.batch order by min(m.created_at) desc limit 20) y));
end;
$$;

drop function if exists public.god_post_notice(text, text, text);   -- 前の形（p_art なし）を外す。3つだけでも呼べる
create or replace function public.god_post_notice(p_kind text, p_title text, p_body text, p_art text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare i bigint;
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception '題を書いてください'; end if;
  if p_kind = 'special' and p_art is null then raise exception '特別なお知らせには刀を選んでください'; end if;
  insert into public.notices (kind, title, body, art) values (p_kind, btrim(p_title), coalesce(p_body, ''), case when p_kind = 'special' then p_art end) returning id into i;
  return i;
end;
$$;

create or replace function public.god_delete_notice(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  update public.notices set deleted = true where id = p_id;
end;
$$;


-- ---------- 条件を満たしたら自動で送る贈り物（2026-11-27） ----------
-- cond: 'issen' = 決着「一閃」を一度でも決めた / 'issen_with' = arg の刀で一閃を決めた / 'katana' = arg の刀を持っている
-- 条件を満たした瞬間（勝ちの記録・ガチャ・鍛えるで持ち物が変わったとき）に、その人の文箱へ一通だけ届く
-- すでにその二つ名・背景を持っている人や、同じ物を手で送られている人には送らない（二重にならない）
create table if not exists public.auto_gifts (
  id text primary key check (id ~ '^[a-z0-9_]{1,32}$'),
  cond text not null,
  arg text,
  gifts jsonb not null,
  subject text not null,
  body text not null default '',
  active boolean not null default true,
  ord int not null default 100
);
create table if not exists public.auto_gifts_given (
  user_id uuid not null references public.profiles(id) on delete cascade,
  gift_id text not null references public.auto_gifts(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (user_id, gift_id)
);
alter table public.auto_gifts drop constraint if exists auto_gifts_cond_check;
alter table public.auto_gifts add constraint auto_gifts_cond_check check (cond in ('issen', 'issen_with', 'katana'));
alter table public.auto_gifts enable row level security;
alter table public.auto_gifts_given enable row level security;
revoke all on public.auto_gifts, public.auto_gifts_given from anon, authenticated;

insert into public.auto_gifts (id, cond, arg, gifts, subject, body, ord) values
  ('issen_ouka_title', 'issen_with', 'ouka', '{"titles":["issen_ouka"]}', '桜華一閃の誉れ',
   E'絶の一振り「桜華」で、後のない刹那に明鏡止水を決めた者へ。\n二つ名「桜華一閃」を贈ります。名乗りの画面で名乗れます。', 0),
  ('issen_title', 'issen', null, '{"titles":["issen"]}', '一閃の誉れ',
   E'後のない刹那に、明鏡止水を決めた者へ。\n二つ名を贈ります。名乗りの画面で名乗れます。', 1),
  ('ouka_plate', 'katana', 'ouka', '{"plates":["ouka"]}', '桜華の札',
   E'絶の一振り「桜華」を手にした者へ。\n背景の札「桜華」を贈ります。名乗りの画面で使えます。', 2),
  ('issen_yata_title', 'issen_with', 'yata', '{"titles":["issen_yata"]}', '八咫一閃の誉れ',
   E'絶の一振り「八咫」で、後のない刹那に明鏡止水を決めた者へ。\n二つ名「八咫一閃」を贈ります。名乗りの画面で名乗れます。', 0),
  ('yata_plate', 'katana', 'yata', '{"plates":["yata"]}', '八咫の札',
   E'絶の一振り「八咫」を手にした者へ。\n背景の札「八咫」を贈ります。名乗りの画面で使えます。', 3)
on conflict (id) do update set cond = excluded.cond, arg = excluded.arg, gifts = excluded.gifts, subject = excluded.subject, body = excluded.body, ord = excluded.ord;

-- その人が条件を満たす贈り物を、まだなら文箱へ入れる。返すのは送った通数
create or replace function public.auto_gift_check(s public.saves) returns int
language plpgsql security definer set search_path = '' as $$
declare a public.auto_gifts; x public.profile_ext; n int := 0; has boolean;
begin
  if public.is_god(s.id) then return 0; end if;   -- 神様は全部持っている
  select * into x from public.profile_ext e where e.id = s.id;
  for a in select * from public.auto_gifts g where g.active order by g.ord loop
    continue when exists (select 1 from public.auto_gifts_given d where d.user_id = s.id and d.gift_id = a.id);
    if a.cond = 'issen' then has := public.has_issen(s);
    elsif a.cond = 'issen_with' then has := jsonb_typeof(s.rec -> a.arg -> '一閃') = 'number' and (s.rec -> a.arg ->> '一閃')::numeric > 0;
    elsif a.cond = 'katana' then has := coalesce((s.owned ->> a.arg)::numeric, 0) > 0;
    else has := false; end if;
    continue when not coalesce(has, false);
    insert into public.auto_gifts_given (user_id, gift_id) values (s.id, a.id) on conflict do nothing;
    -- 同じ物をもう持っている・手で送られている（受け取り前も含む）なら、送ったことにして手紙は出さない
    continue when exists (select 1 from jsonb_array_elements_text(coalesce(a.gifts -> 'titles', '[]')) t
                          where t = any(coalesce(x.titles, '{}'))
                             or exists (select 1 from public.mail m where m.to_id = s.id and m.gifts -> 'titles' ? t))
              or exists (select 1 from jsonb_array_elements_text(coalesce(a.gifts -> 'plates', '[]')) p
                          where p = any(coalesce(x.plates, '{}'))
                             or exists (select 1 from public.mail m where m.to_id = s.id and m.gifts -> 'plates' ? p));
    insert into public.mail (to_id, batch, subject, body, gifts) values (s.id, md5('auto:' || a.id)::uuid, a.subject, a.body, a.gifts);   -- 自動の手紙は贈り物ごとに同じまとまり
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.auto_gift_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.id) then perform public.auto_gift_check(new); end if;
  return new;
end;
$$;
drop trigger if exists saves_auto_gift on public.saves;
create trigger saves_auto_gift after insert or update of owned, rec on public.saves
  for each row execute function public.auto_gift_trigger();

-- いま条件を満たしている人にも届ける（何度実行しても一人一通まで）
select public.auto_gift_check(s) from public.saves s;


-- ---------- 運営へ（不具合報告・改善依頼）（2026-11-27） ----------
-- 遊ぶ人が文箱の「運営へ」から送り、神様が文箱の「届いた」で読む。返事は手紙として文箱へ届く
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  from_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('bug', 'request')),   -- 不具合報告・改善依頼
  body text not null check (char_length(body) between 1 and 1000),
  env text not null default '' check (char_length(env) <= 300),  -- 端末の様子（不具合を直す手がかり）
  status text not null default 'new' check (status in ('new', 'seen', 'done')),
  reply text,
  created_at timestamptz not null default now(),
  replied_at timestamptz
);
create index if not exists reports_from on public.reports (from_id, id desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- 送る（1日10通まで）
create or replace function public.send_report(p_kind text, p_body text, p_env text default '') returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); i bigint; b text := btrim(coalesce(p_body, ''));
begin
  if me is null then raise exception 'ログインしていません'; end if;
  if p_kind not in ('bug', 'request') then raise exception '種類が正しくありません'; end if;
  if char_length(b) = 0 then raise exception '中身を書いてください'; end if;
  if char_length(b) > 1000 then raise exception '1000文字までです'; end if;
  if (select count(*) from public.reports r where r.from_id = me and r.created_at > now() - interval '1 day') >= 10 then
    raise exception '送れるのは1日10通までです。また明日お願いします';
  end if;
  insert into public.reports (from_id, kind, body, env) values (me, p_kind, b, left(coalesce(p_env, ''), 300)) returning id into i;
  return i;
end;
$$;

-- 自分が送ったもの（新しい順に30）
create or replace function public.my_reports() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'body', r.body, 'status', r.status, 'reply', r.reply, 'at', r.created_at) order by r.id desc), '[]')
  from (select * from public.reports x where x.from_id = auth.uid() order by x.id desc limit 30) r;
$$;

-- 神様: 届いたもの（まだ済んでいないものを先に、新しい順に100）
create or replace function public.god_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  return jsonb_build_object(
    'new', (select count(*) from public.reports r where r.status = 'new'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'body', r.body, 'env', r.env, 'status', r.status,
        'reply', r.reply, 'at', r.created_at, 'from', r.from_id, 'name', p.name, 'login', p.login) order by (r.status = 'done'), r.id desc)
      from (select * from public.reports x order by (x.status = 'done'), x.id desc limit 100) r join public.profiles p on p.id = r.from_id), '[]'));
end;
$$;

-- 神様: 読んだ・済んだにする。p_reply があれば、送った人の文箱へ返事の手紙を出す
create or replace function public.god_report_mark(p_id bigint, p_status text, p_reply text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reports; t text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  if p_status not in ('new', 'seen', 'done') then raise exception '状態が正しくありません'; end if;
  select * into r from public.reports x where x.id = p_id for update;
  if r.id is null then raise exception 'その報告はありません'; end if;
  update public.reports set status = p_status, reply = coalesce(t, reply), replied_at = case when t is not null then now() else replied_at end where id = p_id;
  if t is not null then
    insert into public.mail (to_id, batch, subject, body) values (r.from_id, gen_random_uuid(),
      case r.kind when 'bug' then '不具合報告へのお返事' else '改善依頼へのお返事' end,
      left(t, 600 - least(char_length(r.body), 200) - 12) || E'\n\n――あなたが送った文\n' || left(r.body, 200));
  end if;
end;
$$;


-- ---------- 隠し二つ名（一番の人だけが持つ。記録を抜かれたら移る）（2026-11-27） ----------
-- 決着の回数で一番を取るものは「天下　〇〇」（全角の空白）と名付ける（ユーザー指定）
-- 二つ名そのものは title_catalog に hidden = true で入れる（手に入れるまで、条件も名前も一覧に出さない）
-- kind: 'finish' = arg の決着を出した回数 / 'finish_kat' = arg「刀id:決着」の刀でその決着を出した回数 / 'wins' = 勝ちの合計 / 'cpu' = CPU戦の最高の勝ち抜き
--       'katana' = 刀帳の種類 / 'rating' = 戦闘力（オンライン対戦を1回以上した人）
-- 一番が並んだときは、今の持ち主がそのまま持つ（抜いたときだけ移る）。神様は数えない
alter table public.title_catalog add column if not exists hidden boolean not null default false;
insert into public.title_catalog (id, name, note, style, ord, hidden) values
  ('top_meikyo',  '天下　明鏡止水', '明鏡止水を、誰よりも多く決めた者', 'crown', 10, true),
  ('top_issen',   '天下　一閃',     '一閃を、誰よりも多く決めた者',     'crown', 11, true),
  ('top_issen_ouka', '天下　桜華一閃', '絶の一振り「桜華」で、一閃を誰よりも多く決めた者', 'crown', 9, true),
  ('top_issen_yata', '天下　八咫一閃', '絶の一振り「八咫」で、一閃を誰よりも多く決めた者', 'crown', 9, true),
  ('top_hayate', '天下　疾風', '疾風を、誰よりも多く決めた者', 'crown', 30, true),
  ('top_sennosen', '天下　先の先', '先の先を、誰よりも多く決めた者', 'crown', 31, true),
  ('top_sukiugachi', '天下　隙穿ち', '隙穿ちを、誰よりも多く決めた者', 'crown', 32, true),
  ('top_kagero', '天下　陽炎', '陽炎を、誰よりも多く決めた者', 'crown', 33, true),
  ('top_ninotachi', '天下　二の太刀', '二の太刀を、誰よりも多く決めた者', 'crown', 34, true),
  ('top_todome', '天下　止め', '止めを、誰よりも多く決めた者', 'crown', 35, true),
  ('top_shichukatsu', '天下　死中活', '死中活を、誰よりも多く決めた者', 'crown', 36, true),
  ('top_ruten', '天下　流転', '流転を、誰よりも多く決めた者', 'crown', 37, true),
  ('top_kamihitoe', '天下　紙一重', '紙一重を、誰よりも多く決めた者', 'crown', 38, true),
  ('top_kagamigaeshi', '天下　鏡返し', '鏡返しを、誰よりも多く決めた者', 'crown', 39, true),
  ('top_kirifuse', '天下　斬り伏せ', '斬り伏せを、誰よりも多く決めた者', 'crown', 40, true),
  ('top_haisui', '天下　背水', '背水を、誰よりも多く決めた者', 'crown', 41, true),
  ('top_rakka', '天下　落花', '落花を、誰よりも多く決めた者', 'crown', 42, true),
  ('top_setsuna', '天下　刹那', '刹那を、誰よりも多く決めた者', 'crown', 43, true),
  ('top_hyakka', '天下　百花', '百花を、誰よりも多く決めた者', 'crown', 44, true),
  ('top_sange', '天下　散華', '散華を、誰よりも多く決めた者', 'crown', 45, true),
  ('top_wins',    '剣聖',           '誰よりも多く勝った者',             'crown', 12, true),
  ('top_cpu',     '無双',           'CPU戦で、誰よりも多く勝ち抜いた者', 'crown', 13, true),
  ('top_katana',  '刀狩り',         '誰よりも多くの刀を刀帳に記した者', 'crown', 14, true),
  ('top_rating',  '天下一',         '戦闘力が、誰よりも高い者',         'crown', 15, true)
on conflict (id) do update set name = excluded.name, note = excluded.note, style = excluded.style, ord = excluded.ord, hidden = excluded.hidden;
update public.title_catalog set katana = 'ouka' where id = 'top_issen_ouka' and katana is distinct from 'ouka';
update public.title_catalog set katana = 'yata' where id = 'top_issen_yata' and katana is distinct from 'yata';

create table if not exists public.crowns (
  title text primary key references public.title_catalog(id) on delete cascade,
  kind text not null,
  arg text,
  holder uuid references public.profiles(id) on delete set null,
  value numeric not null default 0,
  since timestamptz
);
alter table public.crowns drop constraint if exists crowns_kind_check;
alter table public.crowns add constraint crowns_kind_check check (kind in ('finish', 'finish_kat', 'wins', 'cpu', 'katana', 'rating'));
alter table public.crowns enable row level security;
revoke all on public.crowns from anon, authenticated;
insert into public.crowns (title, kind, arg) values
  ('top_meikyo', 'finish', '明鏡止水'), ('top_issen', 'finish', '一閃'), ('top_wins', 'wins', null),
  ('top_cpu', 'cpu', null), ('top_katana', 'katana', null), ('top_rating', 'rating', null),
  ('top_issen_ouka', 'finish_kat', 'ouka:一閃'), ('top_issen_yata', 'finish_kat', 'yata:一閃'),
  ('top_hayate', 'finish', '疾風'), ('top_sennosen', 'finish', '先の先'), ('top_sukiugachi', 'finish', '隙穿ち'), ('top_kagero', 'finish', '陽炎'), ('top_ninotachi', 'finish', '二の太刀'), ('top_todome', 'finish', '止め'), ('top_shichukatsu', 'finish', '死中活'), ('top_ruten', 'finish', '流転'), ('top_kamihitoe', 'finish', '紙一重'), ('top_kagamigaeshi', 'finish', '鏡返し'), ('top_kirifuse', 'finish', '斬り伏せ'), ('top_haisui', 'finish', '背水'), ('top_rakka', 'finish', '落花'), ('top_setsuna', 'finish', '刹那'), ('top_hyakka', 'finish', '百花'), ('top_sange', 'finish', '散華')
on conflict (title) do update set kind = excluded.kind, arg = excluded.arg;

-- 一人ひとりの値（神様は数えない）
create or replace function public.crown_values(p_kind text, p_arg text) returns table (id uuid, v numeric, born timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id,
    case p_kind
      when 'finish' then coalesce((select sum(case when jsonb_typeof(r.value -> p_arg) = 'number' then (r.value ->> p_arg)::numeric else 0 end)
                                   from jsonb_each(s.rec) r where jsonb_typeof(r.value) = 'object'), 0)
      when 'finish_kat' then coalesce(case when jsonb_typeof(s.rec -> split_part(p_arg, ':', 1) -> split_part(p_arg, ':', 2)) = 'number'
                                      then (s.rec -> split_part(p_arg, ':', 1) ->> split_part(p_arg, ':', 2))::numeric end, 0)
      when 'wins' then coalesce((select sum((f.value)::text::numeric) from jsonb_each(s.rec) r, jsonb_each(r.value) f
                                 where jsonb_typeof(r.value) = 'object' and jsonb_typeof(f.value) = 'number'), 0)
      when 'cpu' then s.cpu_best::numeric
      when 'katana' then (select count(*) from jsonb_each(s.owned) o join public.katana_catalog c on c.id = o.key
                          where jsonb_typeof(o.value) = 'number' and (o.value)::text::numeric > 0)::numeric
      else 0 end,
    s.created_at
  from public.saves s
  where p_kind <> 'rating' and not public.is_god(s.id)
  union all
  select r.id, r.rating::numeric, r.updated_at from public.ratings r
  where p_kind = 'rating' and (r.wins + r.losses) > 0 and not public.is_god(r.id);
$$;

-- 一つの隠し二つ名の持ち主を確かめ直し、変わっていたら移して、二人の文箱に知らせる
create or replace function public.crown_refresh(p_title text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.crowns; t public.title_catalog; top uuid; topv numeric; holdv numeric; nm text;
begin
  select * into c from public.crowns x where x.title = p_title for update;
  if c.title is null then return; end if;
  select * into t from public.title_catalog x where x.id = p_title;
  select v.id, v.v into top, topv from public.crown_values(c.kind, c.arg) v where v.v > 0 order by v.v desc, v.born, v.id limit 1;
  if c.holder is not null then
    select v.v into holdv from public.crown_values(c.kind, c.arg) v where v.id = c.holder;
    -- 並んでいるなら今の持ち主のまま
    if holdv is not null and topv is not null and holdv >= topv then top := c.holder; topv := holdv; end if;
  end if;
  if top is not distinct from c.holder then
    update public.crowns set value = coalesce(topv, 0) where title = p_title;
    return;
  end if;
  -- 前の持ち主から外す（名乗っていたら、残っている二つ名のうち一番上に名乗り替える）
  if c.holder is not null then
    update public.profile_ext e set titles = array_remove(e.titles, p_title),
      title = case when e.title = p_title then
        (select x.id from public.title_catalog x where x.id = any(array_remove(e.titles, p_title)) order by x.ord, x.id limit 1) else e.title end,
      updated_at = now()
    where e.id = c.holder;
    select p.name into nm from public.profiles p where p.id = top;
    insert into public.mail (to_id, batch, subject, body) values (c.holder, gen_random_uuid(), '「' || t.name || '」が移りました',
      case when top is null then '隠し二つ名「' || t.name || '」は、あなたの手を離れました。'
           else '隠し二つ名「' || t.name || '」は、' || coalesce(nm, '誰か') || 'さんの手に渡りました。' || E'\n取り返すには、もう一度一番になること。' end);
  end if;
  if top is not null then
    insert into public.profile_ext (id) values (top) on conflict (id) do nothing;
    update public.profile_ext e set titles = (select coalesce(array_agg(distinct v), '{}') from unnest(e.titles || array[p_title]) v), updated_at = now()
    where e.id = top;
    insert into public.mail (to_id, batch, subject, body) values (top, gen_random_uuid(), '隠し二つ名「' || t.name || '」',
      t.note || 'へ。' || E'\n隠し二つ名「' || t.name || E'」を授けます。名乗りの画面で名乗れます。\nほかの誰かに抜かれたら、その人に移ります。');
  end if;
  update public.crowns set holder = top, value = coalesce(topv, 0), since = now() where title = p_title;
end;
$$;

create or replace function public.crown_refresh_kinds(p_kinds text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare k text;
begin
  for k in select x.title from public.crowns x where x.kind = any(p_kinds) order by x.title loop
    perform public.crown_refresh(k);
  end loop;
end;
$$;

create or replace function public.crown_saves_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crown_refresh_kinds(array['finish', 'finish_kat', 'wins', 'cpu', 'katana']);
  return null;
end;
$$;
drop trigger if exists saves_crowns on public.saves;
create trigger saves_crowns after insert or update of rec, cpu_best, owned on public.saves
  for each statement execute function public.crown_saves_trigger();

create or replace function public.crown_rating_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.crown_refresh_kinds(array['rating']);
  return null;
end;
$$;
drop trigger if exists ratings_crowns on public.ratings;
create trigger ratings_crowns after insert or update on public.ratings
  for each statement execute function public.crown_rating_trigger();

-- いまの一番の人に授ける（何度実行しても、持ち主が変わらなければ何も届かない）
select public.crown_refresh_kinds(array['finish', 'finish_kat', 'wins', 'cpu', 'katana', 'rating']);

-- ---------- 神様は全部を持つ（2026-11-27） ----------
-- 神様（god_accounts）の saves.owned に全部の刀、profile_ext に全部の二つ名・背景の札を入れる。
-- 刀・二つ名・背景を足したとき、神様を足したときにも自動で入る（下のトリガー）。
-- 隠し二つ名「天下　〇〇」も持たせるが、神様は一番の判定から外してあるので、本当の一番の人からは取らない。
-- 持っている刀の本数・銭・玉鋼・戦績・名乗っている二つ名はそのまま
create or replace function public.god_fill() returns void
language plpgsql security definer set search_path = '' as $$
declare ks jsonb; ts text[]; ps text[];
begin
  select coalesce(jsonb_object_agg(c.id, 1), '{}') into ks from public.katana_catalog c;
  select coalesce(array_agg(t.id order by t.ord, t.id), '{}') into ts from public.title_catalog t;
  select coalesce(array_agg(p.id order by p.ord, p.id), '{}') into ps from public.plate_catalog p;
  insert into public.saves (id) select g.id from public.god_accounts g on conflict (id) do nothing;
  update public.saves s set owned = ks || s.owned, updated_at = now()
  where s.id in (select g.id from public.god_accounts g) and not (s.owned @> ks);
  insert into public.profile_ext (id) select g.id from public.god_accounts g on conflict (id) do nothing;
  update public.profile_ext e set titles = ts, plates = ps, updated_at = now()
  where e.id in (select g.id from public.god_accounts g) and (e.titles is distinct from ts or e.plates is distinct from ps);
end;
$$;
create or replace function public.god_fill_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.god_fill(); return null; end;
$$;
drop trigger if exists god_fill_on_god on public.god_accounts;
create trigger god_fill_on_god after insert on public.god_accounts for each statement execute function public.god_fill_trigger();
drop trigger if exists god_fill_on_katana on public.katana_catalog;
create trigger god_fill_on_katana after insert on public.katana_catalog for each statement execute function public.god_fill_trigger();
drop trigger if exists god_fill_on_title on public.title_catalog;
create trigger god_fill_on_title after insert on public.title_catalog for each statement execute function public.god_fill_trigger();
drop trigger if exists god_fill_on_plate on public.plate_catalog;
create trigger god_fill_on_plate after insert on public.plate_catalog for each statement execute function public.god_fill_trigger();
select public.god_fill();

-- ---------- 関数を呼べる人 ----------
revoke execute on function
  public.is_god(uuid), public.profile_json(uuid), public.has_issen(public.saves), public.god_targets(text, text),
  public.get_profile(uuid), public.profile_tags(uuid[]), public.set_profile(text, text, text, text),
  public.my_mail(), public.read_mail(bigint), public.claim_mail(bigint), public.list_notices(),
  public.god_preview(text, text), public.god_send_mail(text, text, text, text, jsonb), public.god_info(),
  public.god_post_notice(text, text, text, text), public.god_delete_notice(bigint),
  public.auto_gift_check(public.saves), public.auto_gift_trigger(),
  public.send_report(text, text, text), public.my_reports(), public.god_reports(), public.god_report_mark(bigint, text, text),
  public.crown_values(text, text), public.crown_refresh(text), public.crown_refresh_kinds(text[]), public.crown_saves_trigger(), public.crown_rating_trigger(),
  public.god_fill(), public.god_fill_trigger()
  from public, anon, authenticated;
grant execute on function
  public.get_profile(uuid), public.profile_tags(uuid[]), public.set_profile(text, text, text, text),
  public.my_mail(), public.read_mail(bigint), public.claim_mail(bigint), public.list_notices(),
  public.god_preview(text, text), public.god_send_mail(text, text, text, text, jsonb), public.god_info(),
  public.god_post_notice(text, text, text, text), public.god_delete_notice(bigint),
  public.send_report(text, text, text), public.my_reports(), public.god_reports(), public.god_report_mark(bigint, text, text)
  to authenticated;
grant execute on function public.list_notices() to anon;
