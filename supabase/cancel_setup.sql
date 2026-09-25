-- ============================================================
--  マイページ② キャンセル機能（ソフトキャンセル）
--  実行場所: Supabase SQL Editor / ※何度実行しても安全
--
--  ・reservations に status('active'/'cancelled')・cancelled_at 列を追加
--  ・本人キャンセル用RPC cancel_reservation(id)：本人か/前日まで/二重防止を
--    サーバーで検査してから status='cancelled' にする（生UPDATEはさせない）
--  ・get_booked_slots からキャンセル分を除外＝キャンセルで枠が空く
-- ============================================================

-- 1. 状態列（既存予約は全て 'active' 扱い）
alter table public.reservations
  add column if not exists status text not null default 'active';
alter table public.reservations
  add column if not exists cancelled_at timestamptz;

-- 2. 本人キャンセル用RPC（本人・前日まで・二重防止をサーバーで検査）
create or replace function public.cancel_reservation(p_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reservations%rowtype;
  jst_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  select * into r from public.reservations where id = p_id;
  if not found then return 'not_found'; end if;
  if r.user_id is null or r.user_id <> auth.uid() then return 'not_owner'; end if;
  if coalesce(r.status,'active') = 'cancelled' then return 'already_cancelled'; end if;
  -- 「前日まで」＝予約日当日・以降は不可（日本時間で判定）
  if r.reservation_date::date <= jst_today then return 'too_late'; end if;
  update public.reservations set status = 'cancelled', cancelled_at = now() where id = p_id;
  return 'ok';
end;
$$;
revoke all on function public.cancel_reservation(bigint) from public;
grant execute on function public.cancel_reservation(bigint) to authenticated;

-- 3. 空き判定からキャンセル分を除外（枠が空く）
create or replace function public.get_booked_slots(from_date date, to_date date)
returns table(reservation_date text, reservation_time text)
language sql
security definer
set search_path to 'public'
as $function$
  select r.reservation_date::text, r.reservation_time::text
  from public.reservations r
  where r.reservation_date::date >= from_date
    and r.reservation_date::date <= to_date
    and coalesce(r.status, 'active') <> 'cancelled';
$function$;
