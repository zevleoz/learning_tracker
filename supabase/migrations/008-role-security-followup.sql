-- ================================================================
-- 008 角色安全收敛（补做）—— 现场实测发现 005 未生效
-- ================================================================
-- 背景：2026-10-08 线上实测确认提权链仍存活：
--   新建学生账号（profiles.role=1）执行
--     supabase.auth.updateUser({ data: { role: 3 } })
--   后 profiles.role 变为 3，is_admin() 返回 true，可调用 admin 级 RPC。
--   说明 auth.users 上仍存在「metadata → profiles.role」的同步触发器，
--   而 005 的清理未生效（可能未执行、执行中断，或该触发器函数名不匹配）。
--
-- 与 005 的区别：本文件不依赖函数/触发器名称，而是按**函数体内容**识别并清除，
-- 因此可以覆盖任何历史补丁留下的同步逻辑。
--
-- 执行：Supabase Dashboard → SQL Editor 整段执行（幂等，可重复运行）。
-- 执行后请把「执行结果」区域的输出贴回，用于确认 PASS。
-- ================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------
-- 1. 删除 auth.users 上「函数体引用 profiles」的全部触发器（不看名字）
--    注意：包含 handle_new_user 的触发器，稍后会重建。
-- ----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select t.tgname, p.proname
    from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
      and pg_get_functiondef(p.oid) like '%profiles%'
  loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
    raise notice '[008] 已删除触发器 % （函数 %）', r.tgname, r.proname;
  end loop;
end $$;

-- ----------------------------------------------------------------
-- 2. 删除「同时引用 raw_user_meta_data 与 profiles」的函数（不看名字）
--    = 所有 metadata → profile 同步函数；handle_new_user 也会被删除并重建
-- ----------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not p.proisagg
      and p.prosrc like '%raw_user_meta_data%'
      and p.prosrc like '%profiles%'
  loop
    execute format('drop function if exists %s cascade', r.sig);
    raise notice '[008] 已删除同步函数 %', r.sig;
  end loop;
end $$;

-- 兜底：按已知名字清理（若上面已删除则跳过）
drop function if exists public.handle_auth_user_profile_sync() cascade;
drop function if exists public.handle_auth_user_updated_profile() cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.guard_profile_role() cascade;

-- ----------------------------------------------------------------
-- 3. 重建 handle_new_user()：role 恒为 1（学生），永不读 metadata 里的 role
-- ----------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
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
-- 4. 重建角色守卫：只有 security definer 路径（owner=postgres/service_role）能改 role
-- ----------------------------------------------------------------
create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
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
-- 5. 角色判定：唯一权威来源 profiles
-- ----------------------------------------------------------------
create or replace function public.is_mentor() returns boolean
language plpgsql security definer stable set search_path = public as $$
declare
  the_role smallint;
begin
  select p.role into the_role from public.profiles p where p.id = auth.uid();
  return coalesce(the_role, 1) >= 2;
end;
$$;

create or replace function public.is_admin() returns boolean
language plpgsql security definer stable set search_path = public as $$
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
-- 6. 唯一合法提权入口：register_teacher()
-- ----------------------------------------------------------------
create or replace function public.register_teacher(key_text text)
returns boolean
language plpgsql security definer set search_path = public as $$
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
-- 执行结果（把这里的输出贴回即可判断是否成功）
-- ----------------------------------------------------------------
select 'check_1 auth.users 上残留的 profiles 触发器（应为 0 行）' as item,
       coalesce(string_agg(t.tgname, ', '), '(无)') as detail
  from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
    and pg_get_functiondef(p.oid) like '%profiles%'
    and t.tgname <> 'on_auth_user_created';

select 'check_2 残留的 metadata→profile 同步函数（应为 0 行）' as item,
       coalesce(string_agg(p.proname, ', '), '(无)') as detail
  from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc like '%raw_user_meta_data%'
    and p.prosrc like '%profiles%'
    and p.proname <> 'handle_new_user';

select 'check_3 handle_new_user 是否已重建（应为 1 行）' as item,
       count(*)::text as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'handle_new_user';

select 'check_4 角色守卫是否安装（应为 1 行）' as item,
       count(*)::text as detail
  from pg_trigger
  where tgrelid = 'public.profiles'::regclass and tgname = 'guard_profile_role' and not tgisinternal;

select 'check_5 is_mentor 是否只读 profiles（应为 PASS）' as item,
       case when pg_get_functiondef('public.is_mentor()'::regprocedure) like '%profiles%'
             and pg_get_functiondef('public.is_mentor()'::regprocedure) not like '%raw_user_meta_data%'
            then 'PASS' else 'FAIL' end as detail;