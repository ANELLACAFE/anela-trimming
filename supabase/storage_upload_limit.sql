-- ══════════════════════════════════════════════════════
-- trimming-photos（写真置き場）へのアップロードを絞る（2026-11-13 本番に適用済み）
-- ══════════════════════════════════════════════════════
-- 問題：INSERT "Allow upload trimming-photos"（誰でも＝public）が bucket_id だけの条件で、
--   公開キー（script.jsに書かれている鍵）があれば誰でも
--   「好きな場所に・好きな大きさの・好きな種類のファイル」を置けた＝容量を埋められる。
-- 対応：
--   (a) お客様（未ログイン/ログイン客）が置けるのは certificates/ 直下（ワクチン証明書）だけ。
--       トリマーカルテ写真（予約ID/…）は管理画面＝スタッフ（public.is_staff()）だけ。
--   (b) バケット全体で「画像（image/*）だけ」「1ファイル10MBまで」。
--       写真はふつう縮小して0.5MB以下で保存されるが、縮小できない時（パソコンのChromeでのHEIC等）は
--       元の画像（スマホ写真で最大8MB程度）のまま保存するため、余裕を見て10MB。
--   ※ 画像かどうかは「送る側が名乗るファイルの種類（Content-Type）」で判定される。
--   ※ 予約フォームの証明書アップロードが万一はじかれても、予約自体は止まらない
--     （script.js の uploadCertImage はエラー時にファイル名だけ記録して続行する）。
--   ※ 一覧・上書き・削除は storage_policy_fix.sql でスタッフ限定にしたまま（変更なし）。

begin;

-- (a) お客様：certificates/ 直下だけ（サブフォルダ不可）
drop policy if exists "Allow upload trimming-photos" on storage.objects;
drop policy if exists "trimming-photos public insert certificates" on storage.objects;
create policy "trimming-photos public insert certificates" on storage.objects
  for insert to public
  with check (bucket_id = 'trimming-photos' and name ~ '^certificates/[^/]+$');

-- (a) スタッフ：どこでも（カルテ写真 予約ID/… を含む）
drop policy if exists "trimming-photos staff insert" on storage.objects;
create policy "trimming-photos staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trimming-photos' and public.is_staff());

-- (b) バケットの制限：画像のみ・10MB（10 * 1024 * 1024 バイト）
update storage.buckets
  set allowed_mime_types = array['image/*'],
      file_size_limit    = 10485760
  where id = 'trimming-photos';

commit;

-- 適用後の確認結果（2026-11-13）
--   公開キー：certificates/ 直下の画像=OK（公開URLも表示OK）／予約ID/…・直下・certificates/sub/…=403
--             text/plain・text/html・application/octet-stream=415／11MB=413／9.5MB=OK
--   予約フォームの uploadCertImage（未ログイン）=OK
--   スタッフ（管理画面ログイン中）：カルテ写真（予約ID/…）のアップロード=OK
--   ※ ブラウザがファイルの種類を判定できない画像（WindowsのChromeでのHEIC等で type が空）は
--     application/octet-stream 扱いになり 415 ではじかれる → 予約は通るが証明書はファイル名だけ記録される。
--   テストで作ったファイルはスタッフのセッションで削除済み。

-- 確認用
-- select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' order by policyname;
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'trimming-photos';

-- 元に戻す場合（緊急時のみ）：
-- drop policy if exists "trimming-photos public insert certificates" on storage.objects;
-- drop policy if exists "trimming-photos staff insert" on storage.objects;
-- create policy "Allow upload trimming-photos" on storage.objects for insert to public with check (bucket_id = 'trimming-photos');
-- update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'trimming-photos';
