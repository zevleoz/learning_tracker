-- ================================================================
-- 005 角色安全收敛（SEC-6）
-- 关闭 user_metadata → profiles.role 的提权链，把「谁是导师/管理员」
-- 收敛为唯一权威来源：public.profiles.role（由 RLS + trigger 保护）。
-- ================================================================
-- 背景：
--   schema.patch-invites.sql 曾安装 security definer 的
--   handle_auth_user_profile_sync()：auth.users.raw_user_meta_data 更新时
--   把 metadata 里的 role 同步进 profiles.role。由于 security definer 以
--   owner（postgres）身份运行，会穿过 guard_profile_role 的白名单，
--   因此 supabase.auth.updateUser({ data: { role: 3 } }) 即可提权。
--   schema.patch-profile-edit-and-rls.sql 又曾 drop 过同名函数并用
--   metadata 判定 admin，实际生产库状态需先审计再执行本文件。
--
-- 执行方式（由用户在 Supabase Dashboard → SQL Editor 整段执行）：
--   1. 先执行文末「附录 A」的审计 SQL，记录当前 trigger / function 实况；
--   2. 再整段执行本文件（幂等，可重复运行）；
--   3. 最后执行文末「附录 B」的验证 SQL，确认输出均为 PASS。
-- ================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------
-- 1. 拆除所有 metadata → role 同步触发器（auth.users 上任何 handle_* / *profile* 触发器）
-- ----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select t.tgname
    from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
      and (p.proname like 'handle_%' or p.proname like '%profile%')
  loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 2. 拆除 profiles 上所有角色守卫触发器（旧名 guard_profile_role / trg_guard_profile_role）
-- ----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select t.tgname
    from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
      and p.proname in ('guard_profile_role')
  loop
    execute format('drop trigger if exists %I on public.profiles', r.tgname);
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 3. 删除相关函数（含 metadata 同步与旧守卫）
-- ----------------------------------------------------------------
drop function if exists public.handle_auth_user_profile_sync() cascade;
drop function if exists public.handle_auth_user_updated_profile() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.guard_profile_role() cascade;

-- ----------------------------------------------------------------
-- 4. 重建 handle_new_user()：role 恒为 1，永不读取 metadata 里的 role
-- ----------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  v_school_name text;
  v_school_id   uuid;
  v_full_name   text;
begin
  v_full_name   := coalesce(new.raw_user_meta_data ->> 'full_name', new.email);
  v_school_name := trim(coalesce(new.raw_user_meta_data ->> 'school_name', ''));

  if v_school_name <> '' then
    select id into v_school_id from public.schools
      where lower(name) = lower(v_school_name) limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (v_school_name) returning id into v_school_id;
    end if;
  end if;

  -- role 恒为 1（学生）；导师提权只能走 register_teacher() RPC
  insert into public.profiles (id, role, full_name, school_id, school_name)
  values (new.id, 1, v_full_name, v_school_id, nullif(v_school_name, ''))
  on conflict (id) do update set
    full_name   = excluded.full_name,
    school_id   = coalesce(excluded.school_id, public.profiles.school_id),
    school_name = coalesce(excluded.school_name, public.profiles.school_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------
-- 5. 重建 guard_profile_role()：只有 security definer 路径（owner=postgres/service_role）
--    才能修改 role 列，普通登录用户永远被拒
-- ----------------------------------------------------------------
create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer as $$
begin
  if OLD.role is distinct from NEW.role then
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
-- 6. 角色判定函数：唯一权威来源是 profiles（防御性重建，覆盖历史 metadata 版本）
-- ----------------------------------------------------------------
create or replace function public.is_mentor() returns boolean
language plpgsql security definer stable as $$
declare
  the_role smallint;
begin
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 2;
end;
$$;

create or replace function public.is_admin() returns boolean
language plpgsql security definer stable as $$
declare
  the_role smallint;
begin
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 3;
end;
$$;

grant execute on function public.is_mentor() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------
-- 7. 唯一合法的提权入口：register_teacher()（幂等重建）
-- ----------------------------------------------------------------
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

  select exists (
    select 1 from public.teacher_keys
    where key_hash = encode(digest(key_text, 'sha256'), 'hex')
  ) into v_key_valid;

  if not v_key_valid then
    raise exception 'Invalid teacher key' using errcode = '42501';
  end if;

  update public.profiles set role = 2, updated_at = now()
  where id = v_uid and role = 1;

  return true;
end;
$$;

revoke all on function public.register_teacher(text) from public;
grant execute on function public.register_teacher(text) to authenticated;

-- ----------------------------------------------------------------
-- 附录 A：执行本文件前的只读审计 SQL（单独运行并留存结果）
-- ----------------------------------------------------------------
-- select t.tgname, c.relnamespace::regnamespace || '.' || c.relname as table, p.proname, p.prosecdef
--   from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_proc p on p.oid = t.tgfoid
--   where c.relname in ('users', 'profiles') and not t.tgisinternal;
--
-- select proname, prosecdef from pg_proc
--   where proname in ('is_mentor','is_admin','handle_new_user','guard_profile_role',
--                     'handle_auth_user_profile_sync','handle_auth_user_updated_profile');
--
-- select pg_get_functiondef('public.is_mentor()'::regprocedure);

-- ----------------------------------------------------------------
-- 附录 B：执行后的验证（期望全部 PASS）
-- ----------------------------------------------------------------
select case when count(*) = 0 then 'PASS 无 metadata 同步触发器'
            else 'FAIL 仍存在：' || string_agg(t.tgname, ', ') end as check_1
  from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
    and (p.proname like 'handle_%' or p.proname like '%profile%');

select case when pg_get_functiondef('public.is_mentor()'::regprocedure) like '%profiles%'
             and pg_get_functiondef('public.is_mentor()'::regprocedure) not like '%raw_user_meta_data%'
            then 'PASS is_mentor 只读 profiles'
            else 'FAIL is_mentor 仍引用 metadata' end as check_2;

select case when pg_get_functiondef('public.handle_new_user()'::regprocedure) not like '%raw_user_meta_data%role%'
            then 'PASS handle_new_user 不读 metadata role'
            else 'FAIL handle_new_user 仍读 metadata role' end as check_3;

select case when exists (
              select 1 from pg_trigger
              where tgrelid = 'public.profiles'::regclass
                and tgname = 'guard_profile_role' and not tgisinternal)
            then 'PASS guard_profile_role 已安装'
            else 'FAIL guard_profile_role 缺失' end as check_4;