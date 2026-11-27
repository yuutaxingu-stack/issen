-- 一閃: 特別なお知らせ（2026-11-27）。supabase/profile.sql と同じ中身の一部です。何度実行しても大丈夫です
-- 特別なお知らせ（2026-11-27）: 看板に絶の刀の抜刀演出を流す。art = 刀の id（例 'yata'）
alter table public.notices add column if not exists art text check (art is null or art ~ '^[a-z0-9_]{1,32}$');
alter table public.notices drop constraint if exists notices_kind_check;
alter table public.notices add constraint notices_kind_check check (kind in ('maint', 'important', 'update', 'special'));

-- ---------- お知らせ（ログインしていなくても読める） ----------
create or replace function public.list_notices() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'at', n.created_at, 'art', n.art) order by n.id desc), '[]')
  from (select * from public.notices x where not x.deleted order by x.id desc limit 40) n;
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

revoke execute on function public.god_post_notice(text, text, text, text) from public, anon, authenticated;
grant execute on function public.god_post_notice(text, text, text, text) to authenticated;
