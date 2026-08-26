-- ------------------------------------------------------------------
-- Admin 自动连接所有学生
-- admin (role >= 3) 登录后调用 admin_connect_all_students() RPC，
-- 自动与所有 role=1 的学生建立 status=1 的连接，跳过邀请流程。
-- ------------------------------------------------------------------

-- 1. is_admin() 判定函数（role >= 3）
-- 安全修复：只从 profiles 表读取 role，不再从 JWT user_metadata 读取
-- （user_metadata 可被用户自行修改 → 提权漏洞）
create or replace function public.is_admin() returns boolean
language plpgsql security definer stable as $$
declare
  the_role smallint;
begin
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 3;
end;
$$;

-- 2. admin_connect_all_students() — admin 调用，给所有学生建立 status=1 连接
create or replace function public.admin_connect_all_students()
returns integer
language plpgsql security definer as $$
declare
  v_admin_id uuid := auth.uid();
  v_count integer := 0;
begin
  -- 只有 admin (role >= 3) 可以调用
  if not public.is_admin() then
    raise exception 'Only admins can connect all students' using errcode = '42501';
  end if;

  -- 给所有 role=1 的学生插入 status=1 连接，已存在的跳过（不覆盖已有状态）
  insert into public.teacher_student_connections (teacher_id, student_id, status, note)
  select v_admin_id, p.id, 1, 'auto-admin'
  from public.profiles p
  where p.role = 1
    and p.id <> v_admin_id
    and not exists (
      select 1 from public.teacher_student_connections t
      where t.teacher_id = v_admin_id and t.student_id = p.id
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 3. 授予 authenticated 角色执行权限（RLS 会通过 is_admin() 控制访问）
grant execute on function public.admin_connect_all_students() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 4. 确认函数已创建
select 'admin_connect_all_students() RPC created successfully' as status;
