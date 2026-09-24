-- ============================================================
--  ANELLA CAFE 予約システム － スタッフ/お客様 権限分離（RLS修正）
--  実施日: 2026-09-24 / 実行場所: Supabase SQL Editor
--
--  背景（重要な脆弱性の修正）:
--    reservations / blacklist / schedule_settings に
--    「auth_all_*（cmd=ALL, roles=authenticated, using=true）」という
--    “ログインした人は全行OK”ポリシーが残っていた。
--    これはスタッフ(admin.html=パスワードログイン)だけがログインする前提で作られたが、
--    お客様のメールOTPログイン導入後は、お客様も authenticated ロールになるため、
--    ログインしたお客様が全予約(氏名/電話/住所)やブラックリストを読める/書ける状態だった。
--    （UIには出ていないがAPI経由で到達可能。約25アカウントが対象だった）
--
--  修正方針:
--    スタッフだけを staff_users に登録し、is_staff() で判定。
--    auth_all_* を is_staff() 限定の *_staff_all に置換。
--    ・お客様(authenticated 非スタッフ): reservations は自分の行のみ(select/insert)。
--    ・未ログイン(anon): 予約の insert は従来どおり(予約は止めない)。
--    ・schedule_settings は全員 read 可(カレンダー表示)、書き込みはスタッフのみ。
--
--  ※ このSQLは何度実行しても安全（IF EXISTS / on conflict do nothing）。
--  ※ スタッフを増やす時は staff_users に該当 auth.users の id を insert する。
-- ============================================================

-- 1. スタッフ一覧テーブル（このリストの人だけ管理者権限）
create table if not exists public.staff_users (
  id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.staff_users enable row level security;
-- ポリシーを作らない = 一般ユーザーからは読めない（判定は is_staff() 経由）

-- 2. スタッフを登録（管理画面ログイン用アカウント）
insert into public.staff_users (id, note)
select id, 'admin: anellacafe.minamiurawa@gmail.com'
from auth.users where email = 'anellacafe.minamiurawa@gmail.com'
on conflict (id) do nothing;

-- 3. スタッフ判定関数（RLSをまたいで staff_users を参照するため security definer）
create or replace function public.is_staff()
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from public.staff_users s where s.id = auth.uid());
$$;

-- 4. reservations：全許可→スタッフ限定（お客様の自分用 select/insert は既存のまま）
drop policy if exists auth_all_reservations on public.reservations;
drop policy if exists reservations_staff_all on public.reservations;
create policy reservations_staff_all on public.reservations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 5. blacklist：全許可→スタッフ限定（お客様/未ログインは is_blacklisted RPC 経由なので直接アクセス不要）
drop policy if exists auth_all_blacklist on public.blacklist;
drop policy if exists blacklist_staff_all on public.blacklist;
create policy blacklist_staff_all on public.blacklist
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 6. schedule_settings：読み取りは全員OK（カレンダー表示に必要）、書き込みはスタッフのみ
--    （anon_select_schedule は既存のまま維持。ログイン客も読めるよう authenticated select を追加）
drop policy if exists auth_all_schedule on public.schedule_settings;
drop policy if exists schedule_select_authenticated on public.schedule_settings;
create policy schedule_select_authenticated on public.schedule_settings
  for select to authenticated using (true);
drop policy if exists schedule_staff_all on public.schedule_settings;
create policy schedule_staff_all on public.schedule_settings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ============================================================
--  確認クエリ（任意）:
--   select tablename, policyname, cmd, roles::text, qual, with_check
--   from pg_policies where schemaname='public'
--   and tablename in ('reservations','blacklist','schedule_settings')
--   order by tablename, cmd, policyname;
--  → auth_all_* が消え、*_staff_all(is_staff) になっていればOK。
-- ============================================================
