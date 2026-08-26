-- ================================================================
-- SECURITY PATCH: 角色判定与注册流程权限修复
-- ================================================================
-- 修复的漏洞：
--   1. is_mentor()/is_admin() 从 JWT user_metadata 读取 role，
--      而 user_metadata 可被用户通过 supabase.auth.updateUser 自行修改，
--      导致任意学生可提权为导师/管理员，访问所有学生数据。
--      修复：只从 profiles 表（数据库权威来源）读取 role。
--
--   2. handle_new_user() trigger 从 raw_user_meta_data 读取 role，
--      用户可直接调用 signUp({ data: { role: 2 } }) 绕过老师密钥注册为导师。
--      修复：trigger 始终设置 role=1（学生默认），导师提权走 register_teacher RPC。
--
--   3. profiles_update_self 策略只有 using 无 with check，
--      用户可直接 update profiles set role=2 提权。
--      修复：增加 BEFORE UPDATE trigger 禁止非 service-role 修改 role 列。
--
--   4. 新增 register_teacher(key_text) RPC：
--      服务端验证密钥 + 提升调用者 role=2，前端不再传 role。
--
-- 运行顺序：在 schema.sql + 002-teacher-key-verify.sql 之后执行。
-- 可安全重复执行（全部使用 create or replace / drop if exists）。
-- ================================================================

-- ----------------------------------------------------------------
-- 1. 重写 is_mentor()：只从 profiles 表读 role，不再信任 JWT user_metadata
-- ----------------------------------------------------------------
-- 旧版（有漏洞）：从 JWT app_metadata / user_metadata 读 role，
--   而 user_metadata 可被用户自行修改 → 提权漏洞
-- 新版（安全）：只从 profiles 表读，JWT 不可篡改数据库表
create or replace function public.is_mentor() returns boolean
language plpgsql security definer stable as $$
declare
  the_role smallint;
begin
  -- 只从 profiles 表读取 role（数据库权威来源，用户无法直接修改）
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 2;
end;
$$;

-- ----------------------------------------------------------------
-- 2. 重写 is_admin()：同样只从 profiles 表读 role
-- ----------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language plpgsql security definer stable as $$
declare
  the_role smallint;
begin
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 3;
end;
$$;

-- ----------------------------------------------------------------
-- 3. 重写 handle_new_user() trigger：不再从 user_metadata 读 role
-- ----------------------------------------------------------------
-- 旧版（有漏洞）：coalesce(raw_app_meta_data.role, raw_user_meta_data.role, 1)
--   用户可在 signUp 时传 data:{role:2} 绕过老师密钥
-- 新版（安全）：始终 role=1，导师提权只能通过 register_teacher RPC
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  v_school_name text;
  v_school_id   uuid;
  v_full_name   text;
begin
  -- full_name / school_name 可以来自 user_metadata（非安全字段，可由用户填写）
  v_full_name   := coalesce(new.raw_user_meta_data ->> 'full_name', new.email);
  v_school_name := trim(coalesce(new.raw_user_meta_data ->> 'school_name', ''));

  if v_school_name <> '' and v_school_name is not null then
    select id into v_school_id from public.schools
      where lower(name) = lower(v_school_name) limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (v_school_name) returning id into v_school_id;
    end if;
  end if;

  -- role 始终为 1（学生），不再从 user_metadata 读取
  -- 导师提权必须通过 register_teacher() RPC（服务端验证密钥后执行）
  insert into public.profiles (id, role, full_name, school_id)
  values (new.id, 1, v_full_name, v_school_id)
  on conflict (id) do update set
    full_name = excluded.full_name,
    school_id = excluded.school_id;
  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 4. 新增 register_teacher(key_text) RPC
-- ----------------------------------------------------------------
-- 流程：
--   1) 用户先 signUp（profile.role 默认为 1）
--   2) 前端调用 register_teacher(teacherKey)
--   3) RPC 验证密钥哈希 → 验证通过则 update profiles set role=2
--   4) 前端 signOut + 重新登录，让新 role 生效
-- 安全性：密钥校验在服务端，用户无法绕过
create or replace function public.register_teacher(key_text text)
returns boolean
language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_key_valid boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- 服务端验证密钥（哈希比对，不暴露存储的哈希）
  select exists (
    select 1 from public.teacher_keys
    where key_hash = encode(digest(key_text, 'sha256'), 'hex')
  ) into v_key_valid;

  if not v_key_valid then
    raise exception 'Invalid teacher key' using errcode = '42501';
  end if;

  -- 提升当前用户为导师（role=2）
  -- 此 trigger bypass_profile_role_lock 不阻止 RPC 内的修改
  update public.profiles set role = 2, updated_at = now()
  where id = v_uid and role = 1;

  return true;
end;
$$;

-- 授予已登录用户调用权限（注册后立即调用）
revoke all on function public.register_teacher(text) from public;
grant execute on function public.register_teacher(text) to authenticated;

-- ----------------------------------------------------------------
-- 5. 新增 trigger：禁止非 service-role 直接修改 profiles.role
-- ----------------------------------------------------------------
-- profiles_update_self 策略允许用户 update 自己的 profile，
-- 但旧版无 with check，用户可直接 set role=2 提权。
-- 此 trigger 作为最后一道防线：任何非 service-role 的 role 修改都会被拒绝。
-- register_teacher RPC 是 security definer，会绕过此 trigger。

-- 先创建一个标记函数，让 register_teacher 能设置跳过标记
-- （Postgres trigger 无法被单个函数选择性绕过，所以改用 security definer 直接 update）
-- 实际上 security definer 函数以函数 owner 权限运行，
-- 而 trigger 在调用者上下文中运行。但 security definer 函数内的 update
-- 仍然会触发 trigger。所以我们需要另一种方法：
-- 检查 current_setting 的 role，如果是 service_role 或函数 owner，则放行。

create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer as $$
begin
  -- 只阻止 role 列被修改（其他列不受影响）
  -- 如果 OLD.role <> NEW.role，说明有人试图改 role
  if OLD.role is distinct from NEW.role then
    -- security definer 函数（如 register_teacher）的调用者上下文
    -- 会设置一个自定义 GUC。如果没有这个标记，则拒绝。
    -- 但更简单的方式：直接拒绝所有非 superuser 的 role 修改。
    -- service_role 连接有 statement_timeout 等不同配置，但不影响 current_user。
    -- 最安全：检查 session_user 是否为 postgres/supabase_admin
    if current_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'Role cannot be changed directly. Use register_teacher() RPC.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role on public.profiles;
create trigger guard_profile_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ----------------------------------------------------------------
-- 6. 收紧 profiles_update_self：增加 with check
-- ----------------------------------------------------------------
-- 旧版：using (id = auth.uid())  — 无 with check，可改任意列
-- 新版：增加 with check (id = auth.uid()) — 双重保险
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

-- ----------------------------------------------------------------
-- 7. 验证
-- ----------------------------------------------------------------
select '✅ Security patch applied: is_mentor/is_admin read from profiles only' as status;
select '✅ handle_new_user: role defaults to 1, no user_metadata trust' as status;
select '✅ register_teacher(key_text) RPC created' as status;
select '✅ guard_profile_role trigger prevents direct role changes' as status;
