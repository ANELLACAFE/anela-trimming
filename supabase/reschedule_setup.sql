-- ============================================================
--  マイページ③ 予約変更（日時・コース・要望）
--  実行場所: Supabase SQL Editor / ※何度実行しても安全
--
--  ・reservations に rescheduled_at 列を追加（管理画面「変更あり」表示に使用）
--  ・本人変更用RPC reschedule_reservation：本人か/前日まで/変更先が有効か/
--    二重予約でないか をサーバーで検査してから日時・コース・要望を更新
--  ・キャンセル同様、生UPDATEはさせずRPC経由（お客様は自分の予約のみ変更可）
-- ============================================================

-- 1. 変更履歴マーカー列
alter table public.reservations add column if not exists rescheduled_at timestamptz;

-- 2. 本人変更用RPC
create or replace function public.reschedule_reservation(
  p_id bigint, p_date date, p_time text, p_course text,
  p_booking_request text, p_options_request text
) returns text
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
  if coalesce(r.status,'active') = 'cancelled' then return 'cancelled'; end if;
  if r.reservation_date <= jst_today then return 'too_late'; end if;   -- 現予約が前日を過ぎ
  if p_date <= jst_today then return 'bad_date'; end if;               -- 変更先が当日以前
  if exists (                                                          -- 二重予約チェック（同一日時に他のactive予約）
    select 1 from public.reservations
    where reservation_date = p_date and reservation_time = p_time::time
      and coalesce(status,'active') <> 'cancelled' and id <> p_id
  ) then return 'slot_taken'; end if;
  update public.reservations
    set reservation_date  = p_date,
        reservation_time  = p_time::time,
        course            = p_course,
        booking_request   = p_booking_request,
        options_request   = p_options_request,
        rescheduled_at    = now()
    where id = p_id;
  return 'ok';
end;
$$;
revoke all on function public.reschedule_reservation(bigint,date,text,text,text,text) from public;
grant execute on function public.reschedule_reservation(bigint,date,text,text,text,text) to authenticated;

-- 備考: 「変更先スロットが営業設定上あいているか(schedule_settings)」はフロントの
--       カレンダーが担保。RPCは整合性の要である二重予約防止を担当する。
