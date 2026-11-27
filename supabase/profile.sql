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

alter table public.title_catalog enable row level security;
alter table public.plate_catalog enable row level security;
alter table public.profile_ext enable row level security;
alter table public.mail enable row level security;
alter table public.notices enable row level security;
revoke all on public.title_catalog, public.plate_catalog, public.profile_ext, public.mail, public.notices from anon, authenticated;

-- ---------- 中身（名前とわけはここを書き換えて、もう一度実行すれば変わる） ----------
insert into public.title_catalog (id, name, note, ord) values
  ('issen', '紫電一閃', '後のない刹那に、明鏡止水を決めた者', 1)
on conflict (id) do update set name = excluded.name, note = excluded.note, ord = excluded.ord;

insert into public.plate_catalog (id, name, note, free, ord) values
  ('sumi',  '墨',   'はじめから使える', true, 1),
  ('take',  '竹林', 'はじめから使える', true, 2),
  ('tsuki', '月夜', 'はじめから使える', true, 3),
  ('ouka',  '桜華', '絶の一振り「桜華」を手にした者', false, 50)
on conflict (id) do update set name = excluded.name, note = excluded.note, free = excluded.free, ord = excluded.ord;

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
declare me uuid := auth.uid(); j jsonb; x public.profile_ext;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  j := public.profile_json(coalesce(p_id, me));
  if j is null then raise exception 'その人は見つかりません'; end if;
  if coalesce(p_id, me) = me then
    -- 自分なら、選べる二つ名・背景も返す
    select * into x from public.profile_ext e where e.id = me;
    j := j || jsonb_build_object('me', true,
      'my_titles', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'note', t.note) order by t.ord, t.id)
                             from public.title_catalog t where t.id = any(coalesce(x.titles, '{}'))), '[]'),
      'my_plates', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'note', p.note) order by p.ord, p.id)
                             from public.plate_catalog p where p.free or p.id = any(coalesce(x.plates, '{}'))), '[]'));
  end if;
  return j;
end;
$$;

-- 名前の横に添える二つ名（番付などの一覧用。最大64人）
create or replace function public.profile_tags(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(x.id, jsonb_build_object('title', t.name, 'plate', x.plate)), '{}')
  from public.profile_ext x left join public.title_catalog t on t.id = x.title
  where auth.uid() is not null and x.id = any(coalesce(p_ids[1:64], '{}')) and (x.title is not null or x.plate is not null);
$$;

-- 自分の名乗りを書き換える。二つ名・背景は持っている物だけ、好きな一振りは持っている刀だけ
create or replace function public.set_profile(p_word text, p_fav text, p_title text, p_plate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); x public.profile_ext; w text;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  insert into public.profile_ext (id) values (me) on conflict (id) do nothing;
  select * into x from public.profile_ext e where e.id = me for update;
  w := btrim(regexp_replace(coalesce(p_word, ''), '\s+', ' ', 'g'));
  if char_length(w) > 30 then raise exception '一言は30文字までです'; end if;
  if p_fav is not null and p_fav <> 'mumei' and not exists (
      select 1 from public.saves s where s.id = me and coalesce((s.owned ->> p_fav)::numeric, 0) > 0) then
    raise exception 'その刀を持っていません';
  end if;
  if p_title is not null and not (p_title = any(x.titles)) then raise exception 'その二つ名は持っていません'; end if;
  if p_plate is not null and not (p_plate = any(x.plates) or exists (select 1 from public.plate_catalog p where p.id = p_plate and p.free)) then
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
    -- 二つ名をまだ名乗っていなければ、もらった二つ名をそのまま名乗る
    title = coalesce(e.title, tl[1]),
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
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'at', n.created_at) order by n.id desc), '[]')
  from (select * from public.notices x where not x.deleted order by x.id desc limit 40) n;
$$;

-- ---------- 運営（神様アカウント）だけが使える処理 ----------
-- 宛先の選び方 p_target:
--   'all'    ログインしたことのある全員
--   'issen'  決着「一閃」を一度でも決めた人（刀ごとの戦績から割り出す）
--   'katana' p_arg の刀（例 'ouka'）を持っている人
--   'login'  p_arg のログインID（カンマ区切りで何人でも）
create or replace function public.god_targets(p_target text, p_arg text) returns table (id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_target = 'all' then
    return query select pr.id from public.profiles pr;
  elsif p_target = 'issen' then
    return query select s.id from public.saves s where public.has_issen(s);
  elsif p_target = 'katana' then
    if not exists (select 1 from public.katana_catalog c where c.id = p_arg) then raise exception 'その刀はありません'; end if;
    return query select s.id from public.saves s where coalesce((s.owned ->> p_arg)::numeric, 0) > 0;
  elsif p_target = 'login' then
    return query select pr.id from public.profiles pr
      where pr.login = any(select btrim(lower(v)) from unnest(string_to_array(coalesce(p_arg, ''), ',')) v);
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
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.ord, t.id), '[]') from public.title_catalog t),
    'plates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'free', p.free) order by p.ord, p.id), '[]') from public.plate_catalog p),
    'sent', (select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]') from (
      select jsonb_build_object('batch', m.batch, 'subject', min(m.subject), 'at', min(m.created_at), 'n', count(*), 'claimed', count(m.claimed_at)) x
      from public.mail m group by m.batch order by min(m.created_at) desc limit 20) y));
end;
$$;

create or replace function public.god_post_notice(p_kind text, p_title text, p_body text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare i bigint;
begin
  if not public.is_god(auth.uid()) then raise exception '神様だけが使えます'; end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception '題を書いてください'; end if;
  insert into public.notices (kind, title, body) values (p_kind, btrim(p_title), coalesce(p_body, '')) returning id into i;
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

-- ---------- 関数を呼べる人 ----------
revoke execute on function
  public.is_god(uuid), public.profile_json(uuid), public.has_issen(public.saves), public.god_targets(text, text),
  public.get_profile(uuid), public.profile_tags(uuid[]), public.set_profile(text, text, text, text),
  public.my_mail(), public.read_mail(bigint), public.claim_mail(bigint), public.list_notices(),
  public.god_preview(text, text), public.god_send_mail(text, text, text, text, jsonb), public.god_info(),
  public.god_post_notice(text, text, text), public.god_delete_notice(bigint)
  from public, anon, authenticated;
grant execute on function
  public.get_profile(uuid), public.profile_tags(uuid[]), public.set_profile(text, text, text, text),
  public.my_mail(), public.read_mail(bigint), public.claim_mail(bigint), public.list_notices(),
  public.god_preview(text, text), public.god_send_mail(text, text, text, text, jsonb), public.god_info(),
  public.god_post_notice(text, text, text), public.god_delete_notice(bigint)
  to authenticated;
grant execute on function public.list_notices() to anon;
