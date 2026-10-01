-- ================================================================
-- 003: e4_reports 删除 RLS 策略（幂等）
-- 过程报告 / 首次报告 / 会前准备 删除需要 DELETE 权限。
-- 与 schema.patch-e4.sql 中的定义保持一致；重跑安全。
-- ================================================================

drop policy if exists e4_reports_delete on public.e4_reports;

create policy e4_reports_delete on public.e4_reports
  for delete to public
  using (public.is_mentor());