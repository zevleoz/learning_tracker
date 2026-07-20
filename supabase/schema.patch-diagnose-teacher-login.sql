-- ================================================================
-- 诊断：老师登录问题
-- 在 Supabase SQL Editor 中以管理员身份运行此脚本
-- ================================================================

-- 1. 检查当前登录用户
select auth.uid() as current_user_id, auth.role() as current_role;

-- 2. 检查 profiles 表中当前用户的信息
select * from public.profiles where id = auth.uid();

-- 3. 检查 auth.users 中当前用户的 user_metadata
select 
  id, 
  email, 
  raw_user_meta_data->>'role' as role_from_metadata,
  raw_user_meta_data->>'full_name' as full_name_from_metadata,
  raw_user_meta_data->>'school_name' as school_name_from_metadata
from auth.users where id = auth.uid();

-- 4. 检查 is_mentor 函数的定义
select prosrc from pg_proc where proname = 'is_mentor';

-- 5. 测试 is_mentor 函数
select public.is_mentor() as is_mentor_result;

-- 6. 检查 profiles 表的 RLS 策略
select schemaname, tablename, policyname, cmd, qual
from pg_policies where tablename = 'profiles';

-- 7. 检查 teacher_student_connections 表是否存在
select exists (select 1 from information_schema.tables where table_name = 'teacher_student_connections') as connections_table_exists;

-- 8. 检查老师端需要的触发器是否存在
select tgname, pg_get_triggerdef(t.oid) as trigger_def
from pg_trigger t
join pg_class c on t.tgrelid = c.oid
where c.relname = 'users' and tgname like 'on_auth_user%';

-- ================================================================
-- 如果发现问题，运行以下修复
-- ================================================================

-- 修复 1：如果 profiles.role 与 user_metadata.role 不一致，手动同步
update public.profiles p
set role = coalesce((u.raw_user_meta_data->>'role')::smallint, p.role),
    full_name = coalesce(u.raw_user_meta_data->>'full_name', p.full_name, u.email),
    school_name = coalesce(u.raw_user_meta_data->>'school_name', p.school_name),
    updated_at = now()
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data is not null
  and (u.raw_user_meta_data->>'role') is not null
  and coalesce((u.raw_user_meta_data->>'role')::smallint, p.role) <> coalesce(p.role, 1);

-- 修复 2：确保 is_mentor 函数正确（从 profiles 表读取）
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

-- 修复 3：确保 profiles 的 select 策略允许老师查看所有学生
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

create policy profiles_select_self_or_mentor on public.profiles
  for select using (
    id = auth.uid()
    or public.is_mentor()
  );

-- ================================================================
-- 完成
-- ================================================================
select '诊断和修复完成' as result;