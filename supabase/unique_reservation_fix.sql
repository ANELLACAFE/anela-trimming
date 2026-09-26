-- ============================================================
--  二重予約防止インデックスを「キャンセル済みを除く」部分インデックスに変更
--  実行場所: Supabase SQL Editor / ※何度実行しても安全
--
--  背景（②キャンセル機能のバグ修正）:
--    unique_reservation は (reservation_date, reservation_time) の一意インデックスで、
--    status を見ていなかった。そのためソフトキャンセル(status='cancelled')した予約も
--    枠を占有し続け、キャンセルで空けたはずの枠に別の予約を入れられなかった
--    （get_booked_slots 上は空きに見えるのに insert が 23505 で弾かれる）。
--
--  対策:
--    「キャンセル済みを除く」部分一意インデックスに置き換える。
--    → 有効な予約どうしの二重予約は引き続き防止しつつ、キャンセル枠は再予約可能に。
--
--  ※ 旧インデックスが「制約」でも「単独インデックス」でも安全に落とせるよう両方 drop。
--    旧索引は全行一意だったので、有効行のみでも重複は無く、部分索引の作成は成功する。
-- ============================================================

alter table public.reservations drop constraint if exists unique_reservation;
drop index if exists public.unique_reservation;

create unique index unique_reservation
  on public.reservations (reservation_date, reservation_time)
  where coalesce(status, 'active') <> 'cancelled';
