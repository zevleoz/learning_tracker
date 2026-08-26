-- ================================================================
-- 修复 Curriculum 页面中章节/单元无法删除的问题
-- 
-- 问题原因：
--   chapters 和 units 表可能缺少 deleted_at 列，导致软删除（UPDATE SET deleted_at）失败
--   或者 RLS 策略未正确配置，导致权限检查失败
--
-- 本脚本是幂等的（idempotent），可以安全地在任何环境中多次运行
-- ================================================================

-- 1. 确保 chapters 表有 deleted_at 列
alter table if exists public.chapters 
  add column if not exists deleted_at timestamptz;

-- 2. 确保 units 表有 deleted_at 列
alter table if exists public.units 
  add column if not exists deleted_at timestamptz;

-- 3. 确保 chapters 和 units 的查询过滤掉已删除的记录
--    注意：这是在应用层（Syllabus.jsx）通过 .is('deleted_at', null) 实现的
--    这里不需要修改数据库层的默认行为

-- 4. 确保 RLS 策略正确配置
--    删除现有的冲突策略（如果存在）
drop policy if exists chapters_update on public.chapters;
drop policy if exists chapters_update_own on public.chapters;
drop policy if exists units_update on public.units;
drop policy if exists units_update_own on public.units;

-- 5. 重新创建 chapters 的 update 策略
--    课程创建者或导师可更新（含软删除）
create policy chapters_update on public.chapters 
  for update to public
  using (
    exists (
      select 1 from public.courses c 
      where c.id = public.chapters.course_id
        and (c.created_by = auth.uid() or public.is_mentor())
    )
  )
  with check (
    exists (
      select 1 from public.courses c 
      where c.id = public.chapters.course_id
        and (c.created_by = auth.uid() or public.is_mentor())
    )
  );

-- 6. 重新创建 units 的 update 策略
--    课程创建者或导师可更新（含软删除）
create policy units_update on public.units 
  for update to public
  using (
    exists (
      select 1 from public.chapters ch
      join public.courses c on c.id = ch.course_id
      where ch.id = public.units.chapter_id
        and (c.created_by = auth.uid() or public.is_mentor())
    )
  )
  with check (
    exists (
      select 1 from public.chapters ch
      join public.courses c on c.id = ch.course_id
      where ch.id = public.units.chapter_id
        and (c.created_by = auth.uid() or public.is_mentor())
    )
  );

-- 7. 同样确保 courses 的 update 策略存在
drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses 
  for update to public
  using (created_by = auth.uid() or public.is_mentor())
  with check (created_by = auth.uid() or public.is_mentor());

-- 完成
select 'Curriculum 章节/单元删除修复完成' as result;
