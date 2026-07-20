-- ================================================================
-- 修复：老师端登录问题
-- 问题原因：is_mentor() 函数定义不一致，可能导致老师身份无法识别
-- ================================================================

-- ================================================================
-- 1. 统一 is_mentor() 函数定义（从 profiles 表读取，这是权威来源）
-- ================================================================
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

-- ================================================================
-- 2. 修复 is_connected_teacher_of() 函数
-- ================================================================
create or replace function public.is_connected_teacher_of(sid uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = sid
      and c.status = 1
  )
  and public.is_mentor();
$$;

-- ================================================================
-- 3. 确保 profiles.role 与 user_metadata.role 同步
-- ================================================================
update public.profiles p
set role        = coalesce((u.raw_user_meta_data->>'role')::smallint, (u.raw_app_meta_data->>'role')::smallint, p.role),
    full_name   = coalesce(u.raw_user_meta_data->>'full_name', u.raw_app_meta_data->>'full_name', p.full_name, u.email),
    school_name = coalesce(u.raw_user_meta_data->>'school_name', u.raw_app_meta_data->>'school_name', p.school_name),
    updated_at  = now()
from auth.users u
where p.id = u.id
  and (
    (u.raw_user_meta_data->>'role') is not null
    or (u.raw_app_meta_data->>'role') is not null
  );

-- ================================================================
-- 4. 修复 handle_new_user 触发器（同时读取 app_meta_data 和 user_meta_data）
-- ================================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  v_school_name text;
  v_school_id   uuid;
  v_role        smallint;
  v_full_name   text;
begin
  v_role      := coalesce(
    (new.raw_app_meta_data ->> 'role')::smallint,
    (new.raw_user_meta_data ->> 'role')::smallint,
    1
  );
  v_full_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_app_meta_data ->> 'full_name',
    new.email
  );
  v_school_name := trim(coalesce(
    new.raw_user_meta_data ->> 'school_name',
    new.raw_app_meta_data ->> 'school_name',
    ''
  ));

  if v_school_name <> '' and v_school_name is not null then
    select id into v_school_id from public.schools
      where lower(name) = lower(v_school_name) limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (v_school_name) returning id into v_school_id;
    end if;
  end if;

  insert into public.profiles (id, role, full_name, school_id)
  values (new.id, v_role, v_full_name, v_school_id);
  return new;
end;
$$;

-- ================================================================
-- 5. 确保 profiles 的 RLS 策略正确
-- ================================================================
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

create policy profiles_select_self_or_mentor on public.profiles
  for select using (
    id = auth.uid()
    or public.is_mentor()
  );

-- ================================================================
-- 6. 确保 learning_sessions 的 RLS 策略正确（老师可以查看已连接学生的数据）
-- ================================================================
drop policy if exists sessions_select on public.learning_sessions;
drop policy if exists sessions_select_access on public.learning_sessions;
drop policy if exists sessions_select_student_or_connected_teacher on public.learning_sessions;
drop policy if exists sessions_select_mentor_access on public.learning_sessions;

create policy sessions_select_access on public.learning_sessions
  for select using (
    student_id = auth.uid()
    or public.is_connected_teacher_of(student_id)
  );

-- ================================================================
-- 7. 验证修复结果
-- ================================================================
select 'is_mentor 函数已统一为从 profiles 表读取' as result;

-- 测试当前用户是否被识别为老师（在 SQL Editor 中以老师账号登录后运行）
-- select public.is_mentor() as is_mentor;