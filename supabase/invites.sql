-- 一閃: 招待コードがないと新しく登録できないようにする（2026-11-27）
-- Supabase の SQL Editor に全部貼り付けて Run。何度実行しても大丈夫です。
-- 中身は supabase/schema.sql の該当部分と同じです。
--   * 神様（運営アカウント）がタイトルの「オンライン」から招待コードを作る。1回使うと無効
--   * コードがないと登録できない（サーバー側で確かめるので、画面を書き換えても登録できない）
--   * すでに登録している人はそのまま遊べる
--   * 招待コードを止めたいときは: update public.app_config set invite_required = false;

-- 前から使っている表・処理（無ければ作る。あれば同じ中身で上書き）
create table if not exists public.god_accounts (
  id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.god_accounts enable row level security;
revoke all on public.god_accounts from anon, authenticated;
create or replace function public.is_god_acct(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u is not null and exists (select 1 from public.god_accounts g where g.id = u);
$$;
revoke execute on function public.is_god_acct(uuid) from public, anon, authenticated;

create or replace function public.has_link(t text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(normalize(coalesce(t, ''), nfkc)) ~
    '(https?|ftp)\s?:\s?/|:\s?//|www\s?\.|[a-z0-9-]+\s?[.。]\s?(com|net|org|info|biz|jp|co|io|me|gg|tv|ly|to|cc|be|us|uk|ru|cn|kr|tw|hk|de|fr|eu|in|ai|so|gl|app|dev|xyz|link|site|online|top|club|shop|page|fun|live|vip|work|blog|store|tech|asia|mobi|pro|world|today|chat|social|moe|tokyo)(?![a-z0-9])|[a-z0-9-]+\.[a-z]{2,}/';
$$;

-- ---------- 招待コード（2026-11-27） ----------
-- 神様（運営アカウント）が1つずつ発行し、それを持つ人だけが新しく登録できる。1回使うと無効。
-- 登録（auth.users に行が入る）のときに handle_new_user から use_invite を呼んで確かめるので、
-- 画面を書き換えて Supabase の登録を直接呼んでも、コードがなければ登録は失敗する。
-- すでに登録している人はそのまま。招待コードを止めたいときは app_config.invite_required を false に。
alter table public.app_config add column if not exists invite_required boolean not null default true;
create table if not exists public.invite_codes (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  memo text not null default '' check (char_length(memo) <= 20),        -- 誰に渡したか（神様だけが見る）
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_by uuid references auth.users(id) on delete set null,            -- 使った人（消えた人は空になるが、使用済みのまま）
  used_at timestamptz
);
alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon, authenticated;

-- 打ち間違いを許す: 小文字・空白・ハイフンは直す
create or replace function public.invite_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- 登録のときに呼ぶ（handle_new_user から）。使えるコードなら使用済みにする。だめなら登録ごと取り消す
create or replace function public.use_invite(u uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text := public.invite_norm(p_code);
begin
  if current_setting('issen.no_invite', true) = 'on' then return; end if;   -- 手元のテスト用（tests/supabase-stub.sql）
  if not coalesce((select invite_required from public.app_config where id = 1), true) then return; end if;
  update public.invite_codes set used_by = u, used_at = now()
   where code = v and used_at is null;
  if not found then raise exception '招待コードが違うか、もう使われています' using errcode = 'P0001'; end if;
end;
$$;

-- 登録画面用: そのコードがまだ使えるか（誰でも呼べる。使えるかどうかだけ返す）
create or replace function public.invite_ok(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select invite_required from public.app_config where id = 1), true)
      or exists (select 1 from public.invite_codes where code = public.invite_norm(p_code) and used_at is null);
$$;

-- 神様: コードを作る（一度に1〜20個）
create or replace function public.invite_create(p_memo text default '', p_n int default 1) returns setof text
language plpgsql security definer set search_path = '' as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 見間違えやすい 0 O 1 I は使わない
  c text; i int; k int;
begin
  if not public.is_god_acct(auth.uid()) then raise exception '神様だけが招待コードを作れます'; end if;
  if p_n is null or p_n < 1 or p_n > 20 then raise exception '一度に作れるのは1〜20個です'; end if;
  if char_length(coalesce(p_memo, '')) > 20 then raise exception 'メモは20文字までです'; end if;
  for k in 1..p_n loop
    loop
      c := '';
      for i in 1..8 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
      exit when not exists (select 1 from public.invite_codes where code = c);
    end loop;
    insert into public.invite_codes (code, memo, created_by) values (c, trim(coalesce(p_memo, '')), auth.uid());
    return next c;
  end loop;
end;
$$;

-- 神様: 一覧（新しい順。使った人の名前とログインIDつき）
create or replace function public.invite_list()
returns table (code text, memo text, created_at timestamptz, used_at timestamptz, used_name text, used_login text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_god_acct(auth.uid()) then raise exception '神様だけが見られます'; end if;
  return query
    select i.code, i.memo, i.created_at, i.used_at, p.name, p.login
    from public.invite_codes i left join public.profiles p on p.id = i.used_by
    order by i.created_at desc limit 300;
end;
$$;

-- 神様: まだ使われていないコードを取り消す
create or replace function public.invite_revoke(p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_god_acct(auth.uid()) then raise exception '神様だけが取り消せます'; end if;
  delete from public.invite_codes where code = public.invite_norm(p_code) and used_at is null;
  return found;
end;
$$;

revoke execute on function public.use_invite(uuid, text), public.invite_ok(text), public.invite_create(text, int),
  public.invite_list(), public.invite_revoke(text), public.invite_norm(text) from public, anon, authenticated;
grant execute on function public.invite_ok(text) to anon, authenticated;
grant execute on function public.invite_create(text, int), public.invite_list(), public.invite_revoke(text) to authenticated;

-- 登録したら利用者の行を作る（招待コードを確かめる1行を足した）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c text;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 見間違えやすい 0 O 1 I は使わない
  i int;
begin
  perform public.use_invite(new.id, new.raw_user_meta_data ->> 'invite');   -- 招待コードがないと登録できない（下の「招待コード」）
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where code = c);
  end loop;
  insert into public.profiles (id, login, name, code)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data ->> 'login', '')),
    case when public.has_link(new.raw_user_meta_data ->> 'name') then left(lower(new.raw_user_meta_data ->> 'login'), 10)   -- リンク入りの名前はログインIDにする
         else coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), lower(new.raw_user_meta_data ->> 'login')) end,
    c
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;
