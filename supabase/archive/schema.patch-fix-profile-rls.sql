-- ================================================================
-- 修复：学生无法查看老师 profile（导致邀请列表无法显示老师姓名）
-- ================================================================

-- 修改 profiles select 策略：学生可以查看给自己发过邀请或已连接的老师
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

create policy profiles_select_self_or_mentor_or_connected on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role >= 2
    )
    or exists (
      select 1 from public.teacher_student_connections c
      where c.student_id = auth.uid()
        and c.teacher_id = public.profiles.id
    )
  );

-- 确保 teacher_student_connections 的 select 策略正确
drop policy if exists tsc_select on public.teacher_student_connections;
create policy tsc_select on public.teacher_student_connections for select using (
  teacher_id = auth.uid() or student_id = auth.uid()
);

-- 确保 teacher_student_connections 的 update 策略允许学生接受/拒绝邀请
drop policy if exists tsc_update_student on public.teacher_student_connections;
create policy tsc_update_student on public.teacher_student_connections for update
using (student_id = auth.uid())
with check (student_id = auth.uid() and status in (1, 2));

-- 确保 is_mentor 函数存在
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;