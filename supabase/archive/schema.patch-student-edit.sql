-- ================================================================
-- 允许学生修改课程/章节/单元名称（仅限自己创建的或同校共享的）
-- 安全加固：使用 RLS 限制为创建者本人或导师，避免任意用户互相篡改
-- ================================================================

-- 1) courses 表的 update 策略：仅创建者本人或导师可修改
drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses for update to public
  using (created_by = auth.uid() or public.is_mentor())
  with check (created_by = auth.uid() or public.is_mentor());

-- 2) chapters 表的 update 策略：仅当课程创建者是当前用户或导师时可修改
drop policy if exists chapters_update on public.chapters;
create policy chapters_update on public.chapters for update to public
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

-- 3) units 表的 update 策略：仅当课程创建者是当前用户或导师时可修改
drop policy if exists units_update on public.units;
create policy units_update on public.units for update to public
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

-- 完成
select '学生编辑权限策略修改完成（已加固为创建者/导师可改）' as result;