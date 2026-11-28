-- 古い差分（2026-11-27）。今の record_win は save-data.sql（p_game 付き）。これは実行しないこと
-- 銭の1日の上限を外す（2026-11-27）。Supabase の SQL Editor で全部を実行する。何度実行しても大丈夫。
-- 戻すときは: update public.app_config set day_coin_cap = 15000 where id = 1;
alter table public.app_config alter column day_coin_cap set default 0;
update public.app_config set day_coin_cap = 0 where id = 1 and day_coin_cap in (5000, 15000);

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

revoke all on function public.record_win(text, text, text) from public, anon, authenticated;
grant execute on function public.record_win(text, text, text) to authenticated;

select 'OK 1日の銭の上限: ' || case when day_coin_cap <= 0 then 'なし' else day_coin_cap::text end as result from public.app_config where id = 1;
