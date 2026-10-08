-- ================================================================
-- 修复：RLS 策略无限递归问题
-- ================================================================

-- ================================================================
-- 1. 删除有问题的策略
-- ================================================================
drop policy if exists profiles_select_all_for_mentor on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

-- ================================================================
-- 2. 创建新的策略（避免递归）
-- ================================================================

-- profiles：本人可见 + 老师可见所有人 + 学生可见给自己发过邀请的老师
-- 使用 auth.users.raw_user_meta_data 来判断是否是老师，避免查询 profiles 表导致递归
create policy profiles_select_mentor_access on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and (u.raw_user_meta_data->>'role')::smallint >= 2
    )
    or exists (
      select 1 from public.teacher_student_connections c
      where c.student_id = auth.uid()
        and c.teacher_id = public.profiles.id
    )
  );

-- ================================================================
-- 3. teacher_student_connections 表的策略
-- ================================================================
alter table public.teacher_student_connections enable row level security;

drop policy if exists tsc_select on public.teacher_student_connections;
drop policy if exists tsc_select_all on public.teacher_student_connections;
create policy tsc_select_access on public.teacher_student_connections
  for select using (
    teacher_id = auth.uid() or student_id = auth.uid()
  );

drop policy if exists tsc_insert_teacher on public.teacher_student_connections;
create policy tsc_insert_teacher on public.teacher_student_connections
  for insert with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and (u.raw_user_meta_data->>'role')::smallint >= 2
    )
    and student_id <> auth.uid()
  );

drop policy if exists tsc_update_student on public.teacher_student_connections;
create policy tsc_update_student on public.teacher_student_connections
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid() and status in (1, 2));

-- ================================================================
-- 4. learning_sessions 表的策略
-- ================================================================
alter table public.learning_sessions enable row level security;

drop policy if exists sessions_select_student_or_connected_teacher on public.learning_sessions;
drop policy if exists sessions_select_student on public.learning_sessions;

create policy sessions_select_mentor_access on public.learning_sessions
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.teacher_student_connections c
      where c.teacher_id = auth.uid()
        and c.student_id = public.learning_sessions.student_id
        and c.status = 1
    )
  );

-- ================================================================
-- 5. 确保 is_mentor() 函数使用 auth.users 而不是 profiles
-- ================================================================
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((u.raw_user_meta_data->>'role')::smallint >= 2, false)
  from auth.users u where u.id = auth.uid();
$$;

-- ================================================================
-- 完成
-- ================================================================
select 'RLS 策略修复完成（避免递归）' as result;