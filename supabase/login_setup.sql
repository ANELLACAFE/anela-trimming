-- ============================================================
--  ANELLA CAFE 予約システム － ログイン機能（第1段階）用 SQL
--  実行場所: Supabase ダッシュボード → SQL Editor に貼り付けて Run
--
--  内容:
--    1. profiles テーブル（飼い主様の情報・1アカウント1件）
--    2. pets     テーブル（わんちゃんの情報・将来の多頭飼いに備え別表）
--    3. RLS（行レベルセキュリティ）… 本人の行しか読み書きできない
--    4. reservations に user_id 列を追加（任意・既存の予約は影響なし）
--
--  ※ このSQLは何度実行しても安全なように書いています（IF NOT EXISTS等）。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 飼い主様プロフィール
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  owner_name      text,
  owner_kana      text,
  phone           text,
  address         text,
  emergency_phone text,
  trigger_text    text,
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is '飼い主様の再利用情報（ログインアカウントに1:1で紐づく）';


-- ------------------------------------------------------------
-- 2. わんちゃん（MVPは1頭のみ利用。将来の多頭飼いに備え別テーブル）
-- ------------------------------------------------------------
create table if not exists public.pets (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.profiles (id) on delete cascade,
  dog_name         text,
  breed            text,
  dog_birthday     text,
  dog_weight       numeric,
  gender           text,
  regular_hospital text,
  allergies        text,
  favorite_spots   text,
  dislike_spots    text,
  medical_history  text,
  spay_neuter      text,
  updated_at       timestamptz not null default now()
);

create index if not exists pets_owner_id_idx on public.pets (owner_id);

comment on table public.pets is 'わんちゃんの再利用情報。1飼い主に複数行を許容（MVPは1頭のみ使用）';


-- ------------------------------------------------------------
-- 3. RLS（行レベルセキュリティ）
--    ★ここがプライバシー保護の要。ログイン中の本人の行だけ読み書き可能。
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.pets     enable row level security;

-- profiles: 本人のみ
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- pets: 本人（owner_id が自分）のみ
drop policy if exists pets_select_own on public.pets;
create policy pets_select_own on public.pets
  for select using (auth.uid() = owner_id);

drop policy if exists pets_insert_own on public.pets;
create policy pets_insert_own on public.pets
  for insert with check (auth.uid() = owner_id);

drop policy if exists pets_update_own on public.pets;
create policy pets_update_own on public.pets
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists pets_delete_own on public.pets;
create policy pets_delete_own on public.pets
  for delete using (auth.uid() = owner_id);


-- ------------------------------------------------------------
-- 4. reservations に「どのアカウントの予約か」を任意で記録する列を追加
--    ・列は NULL 可。ログインせずに予約した場合は NULL のまま。
--    ・既存の予約・匿名予約の挙動は一切変わりません（非破壊）。
-- ------------------------------------------------------------
alter table public.reservations
  add column if not exists user_id uuid references auth.users (id);


-- ============================================================
--  導入後の確認（任意）:
--    別のメールで2アカウント作り、片方でログインした状態で
--    もう片方のデータが select できない（0件になる）ことを確認すると、
--    RLS が正しく効いている証明になります。
-- ============================================================
