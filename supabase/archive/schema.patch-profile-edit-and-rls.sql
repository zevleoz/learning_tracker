-- ================================================================
-- Production Readiness Patch: Profile editing + RLS hardening
--
-- This patch is idempotent. It consolidates the multiple conflicting
-- trigger / is_mentor() definitions left behind by previous patches:
--
--   1. Drops both `on_auth_user_created` AND `on_auth_user_created_profile`
--      triggers and replaces them with ONE unified `on_auth_user_created`
--      that upserts the profile with BOTH school_id AND school_name.
--
--   2. Standardizes `is_mentor()` to read from `auth.users.raw_user_meta_data`
--      (avoids RLS recursion that the profiles-based version causes).
--
--   3. Adds an INSERT policy on `profiles` so the Signup.jsx fallback
--      `profiles.upsert()` works even if the trigger is delayed.
--
--   4. Tightens `profiles_update_self` with a WITH CHECK clause and adds
--      a BEFORE UPDATE trigger that blocks role changes from non-admins
--      (prevents a student escalating to mentor via direct API call).
--
--   5. Adds `update_student_school()` and `update_student_name()` SECURITY
--      DEFINER RPCs so a mentor can edit a connected student's school/name
--      without needing a broad UPDATE RLS policy.
--
--   6. Drops the broken `idx_sessions_student_subject` index that references
--      the non-existent `learning_sessions.subject` column, and replaces it
--      with a correct index on `(student_id, course_id)`.
--
-- Run order: AFTER schema.sql + schema.patch-production.sql.
-- ================================================================

-- ----------------------------------------------------------------
-- 0. Ensure columns exist (safe to re-run)
-- ----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='role') then
    alter table public.profiles add column role smallint not null default 1;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='full_name') then
    alter table public.profiles add column full_name text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='school_name') then
    alter table public.profiles add column school_name text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='updated_at') then
    alter table public.profiles add column updated_at timestamptz default now();
  end if;
end $$;

-- Backfill null roles
update public.profiles set role = 1 where role is null;

-- ----------------------------------------------------------------
-- 1. Standardize is_mentor() (read from auth.users → no RLS recursion)
-- ----------------------------------------------------------------
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce(
    (u.raw_user_meta_data->>'role')::smallint >= 2,
    (u.raw_app_meta_data->>'role')::smallint >= 2,
    false
  )
  from auth.users u
  where u.id = auth.uid();
$$;

-- is_connected_teacher_of() must also use auth.users (avoid recursion)
create or replace function public.is_connected_teacher_of(sid uuid) returns boolean
language sql security definer stable as $$
  select
    exists (
      select 1 from public.teacher_student_connections c
      where c.teacher_id = auth.uid()
        and c.student_id = sid
        and c.status = 1
    )
    and public.is_mentor();
$$;

-- ----------------------------------------------------------------
-- 2. Consolidate the new-user triggers into ONE
-- ----------------------------------------------------------------
drop trigger if exists on_auth_user_created        on auth.users;
drop trigger if exists on_auth_user_created_profile on auth.users;

drop function if exists public.handle_new_user();
drop function if exists public.handle_auth_user_profile_sync();

-- Unified handler: upsert profile with school_id (looked up) AND school_name
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer as $$
declare
  v_role        smallint;
  v_full_name   text;
  v_school_name text;
  v_school_id   uuid;
begin
  v_role        := coalesce((new.raw_user_meta_data->>'role')::smallint,
                            (new.raw_app_meta_data->>'role')::smallint, 1);
  v_full_name   := coalesce(new.raw_user_meta_data->>'full_name', new.email);
  v_school_name := trim(coalesce(new.raw_user_meta_data->>'school_name', ''));

  -- Look up or create the school row (keeps school_id consistent)
  if v_school_name <> '' and v_school_name is not null then
    select id into v_school_id from public.schools
      where lower(name) = lower(v_school_name) limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (v_school_name) returning id into v_school_id;
    end if;
  end if;

  insert into public.profiles (id, role, full_name, school_name, school_id, updated_at, created_at)
  values (new.id, v_role, v_full_name, nullif(v_school_name, ''), v_school_id, now(), now())
  on conflict (id) do update set
    role        = coalesce(excluded.role, public.profiles.role),
    full_name   = coalesce(excluded.full_name, public.profiles.full_name),
    school_name = coalesce(excluded.school_name, public.profiles.school_name),
    school_id   = coalesce(excluded.school_id, public.profiles.school_id),
    updated_at  = now();

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Update trigger: sync auth.users metadata → profiles (for ProfileEditor)
create or replace function public.handle_auth_user_updated_profile() returns trigger
language plpgsql security definer as $$
begin
  update public.profiles set
    full_name   = coalesce(new.raw_user_meta_data->>'full_name', public.profiles.full_name),
    school_name = coalesce(new.raw_user_meta_data->>'school_name', public.profiles.school_name),
    updated_at  = now()
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_profile on auth.users;
create trigger on_auth_user_updated_profile
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_updated_profile();

-- ----------------------------------------------------------------
-- 3. RLS: INSERT policy on profiles (Signup.jsx fallback upsert)
-- ----------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- ----------------------------------------------------------------
-- 4. RLS: tighten UPDATE policy + trigger to block role escalation
-- ----------------------------------------------------------------
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- BEFORE UPDATE trigger: only admins (role >= 3) may change role.
-- Everyone else attempting to change role gets blocked. This is the
-- safety net behind RLS — RLS WITH CHECK cannot compare OLD vs NEW.
create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer as $$
declare
  v_is_admin boolean;
begin
  -- If role is not being changed, allow immediately.
  if OLD.role IS NOT DISTINCT FROM NEW.role then
    return NEW;
  end if;

  -- Role is being changed. Only an admin may do this.
  select coalesce(
    (u.raw_user_meta_data->>'role')::smallint >= 3,
    (u.raw_app_meta_data->>'role')::smallint >= 3,
    false
  )
  into v_is_admin
  from auth.users u
  where u.id = auth.uid();

  if v_is_admin then
    return NEW;
  end if;

  raise exception 'Role changes are restricted to admins' using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_profile_role on public.profiles;
create trigger trg_guard_profile_role
  before update of role on public.profiles
  for each row execute function public.guard_profile_role();

-- ----------------------------------------------------------------
-- 5. RPC: mentor edits a connected student's school / name
-- ----------------------------------------------------------------
create or replace function public.update_student_school(
  p_student_id uuid,
  p_school_name text
) returns void
language plpgsql security definer as $$
declare
  v_school_id uuid;
begin
  if not public.is_mentor() then
    raise exception 'Only mentors can update student school name' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = p_student_id
      and c.status = 1
  ) then
    raise exception 'No accepted connection with this student' using errcode = '42501';
  end if;

  -- Keep school_id in sync with the new name (look up / create)
  if trim(coalesce(p_school_name, '')) <> '' then
    select id into v_school_id from public.schools
      where lower(name) = lower(trim(p_school_name)) limit 1;
    if v_school_id is null then
      insert into public.schools (name) values (trim(p_school_name)) returning id into v_school_id;
    end if;
  end if;

  update public.profiles
    set school_name = trim(p_school_name),
        school_id   = v_school_id,
        updated_at  = now()
  where id = p_student_id;
end;
$$;

create or replace function public.update_student_name(
  p_student_id uuid,
  p_full_name text
) returns void
language plpgsql security definer as $$
begin
  if not public.is_mentor() then
    raise exception 'Only mentors can update student name' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = p_student_id
      and c.status = 1
  ) then
    raise exception 'No accepted connection with this student' using errcode = '42501';
  end if;

  update public.profiles
    set full_name  = trim(p_full_name),
        updated_at = now()
  where id = p_student_id;
end;
$$;

-- Grant execute to anon + authenticated (Supabase API roles)
grant execute on function public.update_student_school(uuid, text) to anon, authenticated;
grant execute on function public.update_student_name(uuid, text) to anon, authenticated;

-- ----------------------------------------------------------------
-- 6. Fix broken index (referenced non-existent learning_sessions.subject)
-- ----------------------------------------------------------------
drop index if exists public.idx_sessions_student_subject;
drop index if exists public.idx_sessions_student_subject_date;

-- Correct index uses course_id (subject lives on courses, not sessions)
create index if not exists idx_sessions_student_course
  on public.learning_sessions(student_id, course_id)
  where deleted_at is null;

-- Date range index (kept as-is)
create index if not exists idx_sessions_date_range
  on public.learning_sessions(session_date desc)
  where deleted_at is null;

-- ----------------------------------------------------------------
-- 7. Verify: sync any existing profiles from auth.users metadata
--    (one-time backfill so old accounts pick up name/school_name)
-- ----------------------------------------------------------------
update public.profiles p
set full_name   = coalesce(p.full_name, u.raw_user_meta_data->>'full_name', u.email),
    school_name = coalesce(p.school_name, u.raw_user_meta_data->>'school_name'),
    role        = coalesce(p.role, (u.raw_user_meta_data->>'role')::smallint, 1),
    updated_at  = now()
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data is not null
  and (p.full_name is null or p.school_name is null or p.role is null);

-- ================================================================
select 'Profile-edit & RLS hardening patch applied' as result;
-- ================================================================
