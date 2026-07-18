-- ================================================================
-- 允许学生修改课程/章节/单元名称
-- ================================================================

-- 1) 修改 courses 表的 update 策略：允许所有 authenticated 用户修改
drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses for update to public
  using (true)
  with check (true);

-- 2) 修改 chapters 表的 update 策略：允许所有 authenticated 用户修改
drop policy if exists chapters_update on public.chapters;
create policy chapters_update on public.chapters for update to public
  using (true)
  with check (true);

-- 3) 修改 units 表的 update 策略：允许所有 authenticated 用户修改
drop policy if exists units_update on public.units;
create policy units_update on public.units for update to public
  using (true)
  with check (true);

-- 完成
select '学生编辑权限策略修改完成' as result;