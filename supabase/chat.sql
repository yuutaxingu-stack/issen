-- =====================================================================
-- 一閃 オープンチャット（フレンドの寄り合い）
-- schema.sql を実行したあとで、このファイルの中身をすべて SQL Editor に貼り付けて「Run」。
-- 何度実行しても大丈夫です（消さずに、足りない物だけ作ります）。
--
-- 見える人:
--   * ふつうの発言・相手求む ……… 送った人と、そのフレンド
--   * 内緒（to_id あり） ………… 送った人と、宛先の人だけ
--   * 立ち合いの知らせ ………… 対戦した二人と、どちらかのフレンド
-- 書き込みは下の処理（関数）を通してだけ。表を直接書き換えることはできない。
-- =====================================================================

create table if not exists public.chat_config (
  id int primary key default 1 check (id = 1),
  max_len int not null default 100,          -- 1回の文字数
  gap_seconds int not null default 3,        -- 連投の間隔
  keep_days int not null default 7,          -- これより古い発言は消える
  recruit_minutes int not null default 3,    -- 「相手求む」の有効時間
  paused boolean not null default false      -- true にするとチャットを止める
);
insert into public.chat_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  author uuid not null references public.profiles(id) on delete cascade,
  partner uuid references public.profiles(id) on delete cascade,  -- 立ち合いの知らせのもう一人
  to_id uuid references public.profiles(id) on delete cascade,    -- 内緒の宛先
  kind text not null check (kind in ('say', 'recruit', 'match_start', 'match_end', 'team')),
  body text not null default '',
  mentions uuid[] not null default '{}',
  ref jsonb not null default '{}',
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created on public.chat_messages (created_at);
create index if not exists chat_messages_author on public.chat_messages (author, created_at);

-- 見えなくする（ミュート）。自分だけに効く
create table if not exists public.chat_mutes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, target)
);

alter table public.chat_config enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_mutes enable row level security;
revoke all on public.chat_config, public.chat_messages, public.chat_mutes from anon, authenticated;
grant select on public.chat_messages, public.chat_mutes to authenticated;

-- 二人がフレンド（承認済み）か
create or replace function public.is_friend(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select x is not null and y is not null and exists (select 1 from public.friendships f
    where f.a = least(x, y) and f.b = greatest(x, y) and f.status = 'accepted');
$$;

-- その発言が自分に見えるか
create or replace function public.chat_visible(m public.chat_messages) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when m.to_id is not null then auth.uid() in (m.author, m.to_id)
    else auth.uid() = m.author or auth.uid() = m.partner
      or public.is_friend(m.author, auth.uid()) or public.is_friend(m.partner, auth.uid())
  end;
$$;

drop policy if exists "chat: 見える発言だけ" on public.chat_messages;
create policy "chat: 見える発言だけ" on public.chat_messages for select to authenticated
  using (public.chat_visible(chat_messages));
drop policy if exists "chat_mutes: 自分の分だけ" on public.chat_mutes;
create policy "chat_mutes: 自分の分だけ" on public.chat_mutes for select to authenticated
  using (user_id = auth.uid());

-- 古い発言を片づける（発言のたびに少しずつ）
create or replace function public.chat_cleanup() returns void
language sql security definer set search_path = '' as $$
  delete from public.chat_messages
  where created_at < now() - make_interval(days => (select keep_days from public.chat_config where id = 1));
$$;

-- 発言する。p_to を入れると内緒（その人にだけ届く）
create or replace function public.chat_post(p_body text, p_mentions uuid[] default '{}', p_to uuid default null, p_kind text default 'say', p_ref jsonb default '{}')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  cfg public.chat_config;
  b text := trim(coalesce(p_body, ''));
  ms uuid[];
  r jsonb := '{}';
  nid bigint;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select * into cfg from public.chat_config where id = 1;
  if cfg.paused then raise exception '今はチャットを休止しています'; end if;
  if p_kind not in ('say', 'recruit', 'team') then raise exception 'その種類の発言はできません'; end if;
  if p_kind = 'say' and b = '' then raise exception '何も書かれていません'; end if;
  if char_length(b) > cfg.max_len then raise exception '%文字までにしてください', cfg.max_len; end if;
  if exists (select 1 from public.chat_messages where author = me and kind in ('say', 'recruit', 'team')
             and created_at > now() - make_interval(secs => cfg.gap_seconds)) then
    raise exception '少し待ってから送ってください';
  end if;
  if p_to is not null then
    if p_kind <> 'say' then raise exception '内緒で送れるのはふつうの発言だけです'; end if;
    if not public.is_friend(me, p_to) then raise exception 'フレンドにだけ送れます'; end if;
  end if;
  -- 名指しはフレンドだけ（重ならないように、最大10人）
  select coalesce(array_agg(distinct x), '{}') into ms
    from unnest(coalesce(p_mentions, '{}')) x where public.is_friend(me, x);
  if p_to is not null then ms := array[p_to]; end if;
  ms := ms[1:10];

  if p_kind = 'recruit' then
    if public.in_match(me) then raise exception '試合中は募集できません'; end if;
    -- 前の募集はしめる
    update public.chat_messages set ref = ref || '{"open": false}'
      where author = me and kind = 'recruit' and (ref ->> 'open')::boolean;
    r := jsonb_build_object('open', true, 'until', now() + make_interval(mins => cfg.recruit_minutes));
  elsif p_kind = 'team' then
    -- 団体戦の募集。部屋の情報は団体戦の処理が入れる（ここでは大きさだけ見る）
    if pg_column_size(p_ref) > 1000 then raise exception '情報が大きすぎます'; end if;
    r := coalesce(p_ref, '{}') || '{"open": true}';
  end if;

  insert into public.chat_messages (author, to_id, kind, body, mentions, ref)
    values (me, p_to, p_kind, b, ms, r) returning id into nid;
  perform public.chat_cleanup();
  return nid;
end;
$$;

-- 自分の発言を消す
create or replace function public.chat_delete(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_messages set deleted = true, body = '', mentions = '{}', ref = ref || '{"open": false}'
    where id = p_id and author = auth.uid() and kind in ('say', 'recruit', 'team');
  if not found then raise exception 'その発言は消せません'; end if;
end;
$$;

-- 自分の「相手求む」をしめる
create or replace function public.chat_close_recruit() returns void
language sql security definer set search_path = '' as $$
  update public.chat_messages set ref = ref || '{"open": false}'
    where author = auth.uid() and kind = 'recruit' and (ref ->> 'open')::boolean;
$$;

-- 「相手求む」に応じる。二人の対戦を作って id を返す（募集した側が朱、応じた側が藍）
create or replace function public.chat_accept_recruit(p_id bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  m public.chat_messages;
  mid uuid;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select * into m from public.chat_messages where id = p_id and kind = 'recruit' for update;
  if not found or m.deleted or not coalesce((m.ref ->> 'open')::boolean, false) then raise exception 'この募集はもうしめ切られました'; end if;
  if (m.ref ->> 'until')::timestamptz < now() then
    update public.chat_messages set ref = ref || '{"open": false}' where id = p_id;
    raise exception 'この募集はもうしめ切られました';
  end if;
  if m.author = me then raise exception '自分の募集には応じられません'; end if;
  if not public.is_friend(me, m.author) then raise exception 'フレンドの募集にだけ応じられます'; end if;
  if public.in_match(me) or public.in_match(m.author) then raise exception 'どちらかが試合中です'; end if;
  insert into public.matches (p0, p1, seed) values (m.author, me, floor(random() * 2147483647)::int)
    returning id into mid;
  update public.chat_messages set ref = ref || jsonb_build_object('open', false, 'match_id', mid, 'taker', me) where id = p_id;
  -- 二人に来ている招待は取り消す
  update public.invites set status = 'cancelled'
    where status = 'pending' and (to_id in (me, m.author) or from_id in (me, m.author));
  return mid;
end;
$$;

-- 見えなくする／戻す
create or replace function public.chat_set_mute(p_target uuid, p_mute boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインしていません'; end if;
  if p_mute then
    insert into public.chat_mutes (user_id, target) values (auth.uid(), p_target) on conflict do nothing;
  else
    delete from public.chat_mutes where user_id = auth.uid() and target = p_target;
  end if;
end;
$$;

-- ---------- 立ち合いの知らせ（対戦が始まった・終わった） ----------
create or replace function public.chat_match_news() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s jsonb; w uuid; fin text; e text; nm jsonb;
begin
  -- 二人の名前も入れておく（フレンドのフレンドの名前は表から読めないため）
  nm := jsonb_build_object('n0', (select name from public.profiles where id = new.p0),
                           'n1', (select name from public.profiles where id = new.p1));
  if tg_op = 'INSERT' then
    insert into public.chat_messages (author, partner, kind, ref)
      values (new.p0, new.p1, 'match_start', nm || jsonb_build_object('match_id', new.id));
  elsif new.status <> old.status and new.status in ('done', 'void', 'abandoned') then
    s := new.result -> 's';
    if new.status = 'done' and jsonb_typeof(s) = 'array' and (s ->> 0) is distinct from (s ->> 1) then
      w := case when (s ->> 0)::numeric > (s ->> 1)::numeric then new.p0 else new.p1 end;
      -- 最後の一本の決着名（h の要素は「決着名:勝った側」）
      select split_part(x, ':', 1) into fin
        from jsonb_array_elements_text(coalesce(new.result -> 'h', '[]')) with ordinality t(x, i)
        where split_part(x, ':', 2) in ('0', '1') order by i desc limit 1;
    end if;
    insert into public.chat_messages (author, partner, kind, ref)
      values (new.p0, new.p1, 'match_end', nm || jsonb_build_object(
        'match_id', new.id, 'status', new.status, 'winner', w, 'finish', fin, 'score', s));
  end if;
  return new;
exception when others then
  get stacked diagnostics e = message_text;
  raise warning '立ち合いの知らせを書けませんでした: %', e;   -- 知らせで失敗しても試合は止めない
  return new;
end;
$$;
drop trigger if exists matches_chat_start on public.matches;
create trigger matches_chat_start after insert on public.matches
  for each row execute function public.chat_match_news();
drop trigger if exists matches_chat_end on public.matches;
create trigger matches_chat_end after update of status on public.matches
  for each row execute function public.chat_match_news();

-- ---------- 関数を呼べる人 ----------
revoke execute on function public.chat_cleanup(), public.chat_match_news() from public, anon, authenticated;
revoke execute on function public.is_friend(uuid, uuid), public.chat_visible(public.chat_messages),
  public.chat_post(text, uuid[], uuid, text, jsonb), public.chat_delete(bigint), public.chat_close_recruit(),
  public.chat_accept_recruit(bigint), public.chat_set_mute(uuid, boolean) from public, anon;
grant execute on function public.is_friend(uuid, uuid), public.chat_visible(public.chat_messages),
  public.chat_post(text, uuid[], uuid, text, jsonb), public.chat_delete(bigint), public.chat_close_recruit(),
  public.chat_accept_recruit(bigint), public.chat_set_mute(uuid, boolean) to authenticated;

-- ---------- リアルタイム（新しい発言をすぐ届ける） ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- 寄合の部屋 chat:<自分のid> に入れるようにする（schema.sql の部屋の守りに足す形。どちらを先に実行してもよい）
drop policy if exists "issen: 寄合を読む" on realtime.messages;
create policy "issen: 寄合を読む" on realtime.messages for select to authenticated
  using (auth.uid() is not null and realtime.topic() = 'chat:' || auth.uid()::text);
