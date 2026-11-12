-- ══════════════════════════════════════════════════════
-- trimming-photos（写真置き場）の権限をスタッフ/お客様で分離（2026-11-13）
-- ══════════════════════════════════════════════════════
-- 問題：storage.objects に「誰でも(public)」向けの SELECT と DELETE が付いていた。
--   ・SELECT … 公開キー（script.jsに書かれている鍵）でバケットの一覧が取れる
--              ＝ワクチン証明書のファイル名→公開URLを第三者が列挙できた
--   ・DELETE … 公開キーで全写真を削除できた
-- 対応：一覧・上書き・削除はスタッフ（public.is_staff()）だけに。
--   ・画像の表示は「公開URL」（バケットが public=true）なので RLS と無関係に今まで通り見られる。
--   ・お客様の証明書アップロード（INSERT "Allow upload trimming-photos"）はそのまま
--     ＝予約フォームは止めない。フロントは upsert:false（INSERTだけで済む）に変更済み。
--   ・スタッフの UPDATE は既存写真を縮小版へ置き換える作業（同じパスへ上書き）で使う。

drop policy if exists "Public read trimming-photos"  on storage.objects;
drop policy if exists "Allow delete trimming-photos" on storage.objects;

drop policy if exists "trimming-photos staff select" on storage.objects;
create policy "trimming-photos staff select" on storage.objects
  for select to authenticated
  using (bucket_id = 'trimming-photos' and public.is_staff());

drop policy if exists "trimming-photos staff update" on storage.objects;
create policy "trimming-photos staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'trimming-photos' and public.is_staff())
  with check (bucket_id = 'trimming-photos' and public.is_staff());

drop policy if exists "trimming-photos staff delete" on storage.objects;
create policy "trimming-photos staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trimming-photos' and public.is_staff());

-- 確認用
-- select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage';

-- 元に戻す場合（緊急時のみ）：
-- create policy "Public read trimming-photos"  on storage.objects for select to public using (bucket_id = 'trimming-photos');
-- create policy "Allow delete trimming-photos" on storage.objects for delete to public using (bucket_id = 'trimming-photos');
