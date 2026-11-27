-- =====================================================================
-- 一閃 図鑑（2026-11-27）
-- 二つ名・背景の札の一覧を、自分が持っているかどうかと一緒に返す。
-- 隠し二つ名（天下〇〇・剣聖など）は、一度でも手にした人にだけ名前と条件を見せる。
-- 先に profile.sql を実行しておくこと。何度実行してもよい。
-- =====================================================================

-- 一度でも手にした二つ名（隠し二つ名は抜かれると外れるので、ここに覚えておく）
create table if not exists public.title_seen (
  id uuid not null references public.profiles(id) on delete cascade,
  title text not null references public.title_catalog(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (id, title)
);
alter table public.title_seen enable row level security;
revoke all on public.title_seen from anon, authenticated;

create or replace function public.title_seen_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.title_seen (id, title)
  select new.id, t from unnest(coalesce(new.titles, '{}')) t
  where exists (select 1 from public.title_catalog c where c.id = t)
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists profile_ext_title_seen on public.profile_ext;
create trigger profile_ext_title_seen after insert or update of titles on public.profile_ext
  for each row execute function public.title_seen_trigger();

-- いま持っている人の分を覚える（何度実行しても増えない）
insert into public.title_seen (id, title)
select e.id, t from public.profile_ext e, unnest(e.titles) t
where exists (select 1 from public.title_catalog c where c.id = t)
on conflict do nothing;

-- 図鑑の中身
create or replace function public.zukan() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); g boolean := public.is_god(auth.uid()); x public.profile_ext;
begin
  if me is null then raise exception 'ログインしていません'; end if;
  select * into x from public.profile_ext e where e.id = me;
  return jsonb_build_object(
    'titles', (select coalesce(jsonb_agg(j order by o1, o2), '[]') from (
      select t.ord o1, t.id o2,
        case when not t.hidden or g or s.id is not null
          then jsonb_build_object('id', t.id, 'name', t.name, 'note', t.note, 'style', t.style, 'hidden', t.hidden,
                                  'have', g or t.id = any(coalesce(x.titles, '{}')), 'seen', s.id is not null)
          else jsonb_build_object('hidden', true, 'have', false, 'seen', false) end j
      from public.title_catalog t
      left join public.title_seen s on s.id = me and s.title = t.id) q),
    'plates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'note', p.note, 'free', p.free,
                 'have', g or p.free or p.id = any(coalesce(x.plates, '{}'))) order by p.ord, p.id), '[]')
               from public.plate_catalog p));
end;
$$;

revoke execute on function public.title_seen_trigger(), public.zukan() from public, anon, authenticated;
grant execute on function public.zukan() to authenticated;
