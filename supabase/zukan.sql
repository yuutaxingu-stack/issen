-- =====================================================================
-- 一閃 図鑑（2026-11-27）
-- 二つ名・背景の札の一覧を、自分が持っているかどうかと一緒に返す。
-- 隠し二つ名（天下〇〇・剣聖など）は、一度でも手にした人にだけ名前と条件を見せる。
-- 先に save-data.sql と profile.sql を実行しておくこと。何度実行してもよい。
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

-- 図鑑より前に手にして、もう抜かれた隠し二つ名も覚える（文箱に残る「授けます」「移りました」の手紙から。2026-11-28）
insert into public.title_seen (id, title, at)
select m.to_id, t.id, min(m.created_at) from public.mail m join public.title_catalog t on t.hidden
  and m.subject in ('隠し二つ名「' || t.name || '」', '「' || t.name || '」が移りました')
group by m.to_id, t.id
on conflict do nothing;

-- 新・一閃にしかない決着は、これまでの回数を新・一閃の分（saves.rec_new）にも写す（2026-11-28 に旧と新を分けて数え始めた）
-- 何度実行しても、新・一閃の分が rec より多くなることはない
do $$
declare r record;
begin
  for r in select s.id, k.key kat, f.key fin, (f.value)::text::bigint n
           from public.saves s, jsonb_each(s.rec) k, jsonb_each(k.value) f
           where jsonb_typeof(k.value) = 'object' and jsonb_typeof(f.value) = 'number'
             and f.key in ('斬り伏せ', '背水', '落花', '刹那', '百花', '散華')
             and coalesce((s.rec_new -> k.key ->> f.key)::bigint, 0) < (f.value)::text::bigint loop
    update public.saves x set rec_new = jsonb_set(x.rec_new, array[r.kat], coalesce(x.rec_new -> r.kat, '{}') || jsonb_build_object(r.fin, r.n))
    where x.id = r.id;
  end loop;
end $$;

-- その刀の箱が公開済みか（刀にまつわらない物は常に true）。公開前の箱の二つ名・背景は、神様と持っている人にだけ見せる
create or replace function public.katana_shown(k text) returns boolean
language sql stable security definer set search_path = '' as $$
  select k is null or exists (select 1 from public.katana_catalog c join public.gacha_boxes b on b.id = c.box where c.id = k and b.open);
$$;

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
      left join public.title_seen s on s.id = me and s.title = t.id
      where g or s.id is not null or public.katana_shown(t.katana)) q),
    'plates', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'note', p.note, 'free', p.free,
                 'have', g or p.free or p.id = any(coalesce(x.plates, '{}'))) order by p.ord, p.id), '[]')
               from public.plate_catalog p
               where g or p.id = any(coalesce(x.plates, '{}')) or public.katana_shown(p.katana)));
end;
$$;

revoke execute on function public.title_seen_trigger(), public.katana_shown(text), public.zukan() from public, anon, authenticated;
grant execute on function public.zukan() to authenticated;
