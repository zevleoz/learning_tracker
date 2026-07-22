-- ================================================================
-- PRODUCTION SETUP MIGRATION
-- Sequence: Run this once before production deployment
-- ================================================================

-- ================================================================
-- PART 1: Create missing tables
-- ================================================================

-- Table: teacher_student_connections
create table if not exists public.teacher_student_connections (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status smallint not null default 0,   -- 0=pending  1=accepted  2=rejected
  note varchar(200),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (teacher_id, student_id)
);

-- ================================================================
-- PART 2: Security helper functions
-- ================================================================

-- Check if current user is a mentor (role >= 2)
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

-- Check if current user is a connected teacher of a specific student
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
-- PART 3: Data integrity & Role synchronization
-- ================================================================

-- Ensure role column exists and has default
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='role') then
    alter table public.profiles add column role smallint not null default 1;
  end if;
end $$;

-- Set null roles to student (1)
update public.profiles set role = 1 where role is null;

-- Ensure full_name and school_name columns exist
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='full_name') then
    alter table public.profiles add column full_name text;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='school_name') then
    alter table public.profiles add column school_name text;
  end if;
end $$;

-- Sync roles from auth.users to profiles
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
-- PART 4: Auth sync trigger
-- ================================================================

create or replace function public.handle_auth_user_profile_sync() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, school_name, role, updated_at, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_app_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'school_name', new.raw_app_meta_data->>'school_name'),
    coalesce((new.raw_user_meta_data->>'role')::smallint, (new.raw_app_meta_data->>'role')::smallint, 1),
    now(),
    now()
  )
  on conflict (id) do update set
    full_name   = coalesce(new.raw_user_meta_data->>'full_name', new.raw_app_meta_data->>'full_name', public.profiles.full_name),
    school_name = coalesce(new.raw_user_meta_data->>'school_name', new.raw_app_meta_data->>'school_name', public.profiles.school_name),
    role        = coalesce((new.raw_user_meta_data->>'role')::smallint, (new.raw_app_meta_data->>'role')::smallint, public.profiles.role, 1),
    updated_at  = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
drop trigger if exists on_auth_user_updated_profile on auth.users;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_auth_user_profile_sync();

create trigger on_auth_user_updated_profile
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_profile_sync();

-- ================================================================
-- PART 5: RLS policies
-- ================================================================

-- profiles: student can see own, mentor can see all
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

create policy profiles_select_self_or_mentor on public.profiles
  for select using (id = auth.uid() or public.is_mentor());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

-- learning_sessions: student can see own, connected mentor can see
alter table public.learning_sessions enable row level security;

drop policy if exists sessions_select on public.learning_sessions;
drop policy if exists sessions_select_access on public.learning_sessions;
drop policy if exists sessions_select_student_or_connected_teacher on public.learning_sessions;
drop policy if exists sessions_select_mentor_access on public.learning_sessions;

create policy sessions_select_access on public.learning_sessions
  for select using (student_id = auth.uid() or public.is_connected_teacher_of(student_id));

drop policy if exists sessions_write on public.learning_sessions;
create policy sessions_write on public.learning_sessions
  for insert to public with check (student_id = auth.uid());

drop policy if exists sessions_update on public.learning_sessions;
create policy sessions_update on public.learning_sessions
  for update to public using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- teacher_student_connections: teacher can manage, student can see
alter table public.teacher_student_connections enable row level security;

drop policy if exists tsc_select on public.teacher_student_connections;
create policy tsc_select on public.teacher_student_connections for select using (
  teacher_id = auth.uid() or student_id = auth.uid()
);

drop policy if exists tsc_insert_teacher on public.teacher_student_connections;
create policy tsc_insert_teacher on public.teacher_student_connections for insert to public
with check (
  teacher_id = auth.uid()
  and public.is_mentor()
  and student_id <> auth.uid()
);

drop policy if exists tsc_update_student on public.teacher_student_connections;
create policy tsc_update_student on public.teacher_student_connections for update to public
using (student_id = auth.uid())
with check (student_id = auth.uid() and status in (1, 2));

drop policy if exists tsc_delete_teacher on public.teacher_student_connections;
create policy tsc_delete_teacher on public.teacher_student_connections for delete to public
using (teacher_id = auth.uid() and status = 0);

-- signals (if exists)
do $do$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='signals') then
    alter table public.signals enable row level security;
    drop policy if exists signals_select on public.signals;
    execute 'create policy signals_select on public.signals for select using (
      student_id = auth.uid() or public.is_connected_teacher_of(student_id)
    )';
  end if;
end $do$;

-- daily_checkins (if exists)
do $do$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='daily_checkins') then
    alter table public.daily_checkins enable row level security;
    drop policy if exists checkins_select on public.daily_checkins;
    execute 'create policy checkins_select on public.daily_checkins for select using (
      student_id = auth.uid() or public.is_connected_teacher_of(student_id)
    )';
    drop policy if exists checkins_write on public.daily_checkins;
    execute 'create policy checkins_write on public.daily_checkins
      for insert to public with check (student_id = auth.uid())';
  end if;
end $do$;

-- student_courses (if exists)
do $do$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='student_courses') then
    alter table public.student_courses enable row level security;
    drop policy if exists student_courses_select on public.student_courses;
    execute 'create policy student_courses_select on public.student_courses for select using (
      student_id = auth.uid() or public.is_connected_teacher_of(student_id)
    )';
    drop policy if exists student_courses_write on public.student_courses;
    execute 'create policy student_courses_write on public.student_courses
      for insert to public with check (student_id = auth.uid())';
  end if;
end $do$;

-- mentor_feedback (if exists)
do $do$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='mentor_feedback') then
    alter table public.mentor_feedback enable row level security;
    drop policy if exists feedback_select on public.mentor_feedback;
    execute 'create policy feedback_select on public.mentor_feedback for select using (
      student_id = auth.uid() or mentor_id = auth.uid()
    )';
    drop policy if exists feedback_write on public.mentor_feedback;
    execute 'create policy feedback_write on public.mentor_feedback
      for insert to public with check (
        mentor_id = auth.uid()
        and public.is_mentor()
        and public.is_connected_teacher_of(student_id)
      )';
  end if;
end $do$;

-- ================================================================
-- PART 6: Performance indexes
-- ================================================================

-- Indexes for teacher_student_connections
create index if not exists tsc_teacher on public.teacher_student_connections(teacher_id, status);
create index if not exists tsc_student on public.teacher_student_connections(student_id, status);

-- Index for mentor analytics queries (learning_sessions uses course_id, not subject)
create index if not exists idx_sessions_student_course 
on public.learning_sessions(student_id, course_id)
where deleted_at is null;

-- Index for date range queries
create index if not exists idx_sessions_date_range
on public.learning_sessions(session_date desc)
where deleted_at is null;

-- Index for efficient course aggregation
create index if not exists idx_sessions_student_course_date
on public.learning_sessions(student_id, course_id, session_date desc)
where deleted_at is null;

-- ================================================================
-- PART 7: Verify migration
-- ================================================================

select '✅ Production migration completed successfully' as result;
select '📊 Tables:' as check;
select table_name from information_schema.tables where table_schema = 'public' order by table_name;
select '🔒 RLS enabled tables:' as check;
select relname from pg_class where relrowsecurity = true order by relname;
select '🔑 Helper functions:' as check;
select proname from pg_proc where pronamespace = (select oid from pg_namespace where nspname = 'public') and proname in ('is_mentor', 'is_connected_teacher_of');
