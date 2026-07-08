-- ================================================================
-- 修复：permission denied for table users
-- 使用 security definer 函数来封装权限检查
-- ================================================================

-- ================================================================
-- 1. 创建 security definer 函数来检查用户角色
-- ================================================================

-- 检查当前用户是否是老师（role >= 2）
-- 使用 security definer，函数以超级用户身份执行，有权限访问 auth.users
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((u.raw_user_meta_data->>'role')::smallint >= 2, false)
  from auth.users u where u.id = auth.uid();
$$;

-- 检查当前用户是否是指定学生的已连接老师
create or replace function public.is_connected_teacher_of(sid uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = sid
      and c.status = 1
  )
  and exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and (u.raw_user_meta_data->>'role')::smallint >= 2
  );
$$;

-- ================================================================
-- 2. 删除有问题的策略
-- ================================================================
drop policy if exists profiles_select_mentor_access on public.profiles;
drop policy if exists profiles_select_all_for_mentor on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

-- ================================================================
-- 3. 创建新的 profiles 策略（使用 security definer 函数）
-- ================================================================
alter table public.profiles enable row level security;

create policy profiles_select_access on public.profiles
  for select using (
    id = auth.uid()
    or public.is_mentor()
    or exists (
      select 1 from public.teacher_student_connections c
      where c.student_id = auth.uid()
        and c.teacher_id = public.profiles.id
    )
  );

-- ================================================================
-- 4. teacher_student_connections 表的策略
-- ================================================================
alter table public.teacher_student_connections enable row level security;

drop policy if exists tsc_select_access on public.teacher_student_connections;
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
    and public.is_mentor()
    and student_id <> auth.uid()
  );

drop policy if exists tsc_update_student on public.teacher_student_connections;
create policy tsc_update_student on public.teacher_student_connections
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid() and status in (1, 2));

-- ================================================================
-- 5. learning_sessions 表的策略
-- ================================================================
alter table public.learning_sessions enable row level security;

drop policy if exists sessions_select_mentor_access on public.learning_sessions;
drop policy if exists sessions_select_student on public.learning_sessions;
drop policy if exists sessions_select_student_or_connected_teacher on public.learning_sessions;

create policy sessions_select_access on public.learning_sessions
  for select using (
    student_id = auth.uid()
    or public.is_connected_teacher_of(student_id)
  );

-- ================================================================
-- 完成
-- ================================================================
select 'RLS 策略修复完成（security definer）' as result;