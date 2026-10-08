-- ================================================================
-- GPA Tracker v2.2 —— 老师 ↔ 学生 邀请系统
--   * 新表 teacher_student_connections（status: pending/accepted/rejected）
--   * 新的 RLS 语义：
--        学生 profile：任何人可读（用于导师浏览）
--        学习记录 / 打卡 / 信号 / 导师反馈：
--           - 学生本人可读
--           - 已连接的导师可读
--           - 导师反馈：mentor 写自己给学生的
--   * 不再用旧的 "is_mentor 全量可见" —— 导师只能看"自己学生"的数据
--   * 显式修复：确保 auth.users.raw_user_meta_data 中的 role 同步到 public.profiles.role
--
--   ★ 请在 Supabase SQL Editor 运行；不会删除现有数据
-- ================================================================

-- ----------------------------------------------------------------
-- 0) 确保 profiles 表有 role 列 & 一个合理的默认值
-- ----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='role') then
    alter table public.profiles add column role smallint not null default 1;
  end if;
end $$;

-- 已有 role 列，但可能是 null —— 把所有 null 的 role 设为 1（学生）
update public.profiles set role = 1 where role is null;

-- 如果 profiles 没有 full_name / school_name 列也补上（安全兜底）
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
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='updated_at') then
    alter table public.profiles add column updated_at timestamptz default now();
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles' and column_name='created_at') then
    alter table public.profiles add column created_at timestamptz default now();
  end if;
end $$;

-- ----------------------------------------------------------------
-- 1) 新表：邀请/连接
-- ----------------------------------------------------------------

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

create index if not exists tsc_teacher on public.teacher_student_connections(teacher_id, status);
create index if not exists tsc_student on public.teacher_student_connections(student_id, status);

-- 是否"该学生的已连接老师"
create or replace function public.is_connected_teacher_of(sid uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = sid
      and c.status = 1
  )
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role >= 2);
$$;

-- 仅从 profile.role 判定是否老师；不隐含可见权限
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

-- ----------------------------------------------------------------
-- 1.5) auth.users.raw_user_meta_data → public.profiles.role 的自动同步
--      修复：注册时选了"我是老师"，结果 profiles.role 还是默认 1
-- ----------------------------------------------------------------

-- 先把历史数据修一次（安全：只有 raw_user_meta_data 中 role 与当前 profile.role 不一致时才覆盖）
update public.profiles p
set role        = coalesce((u.raw_user_meta_data->>'role')::smallint, p.role),
    full_name   = coalesce(u.raw_user_meta_data->>'full_name', p.full_name, u.email),
    school_name = coalesce(u.raw_user_meta_data->>'school_name', p.school_name),
    updated_at  = now()
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data is not null
  and (
    (u.raw_user_meta_data->>'role') is not null
      and coalesce((u.raw_user_meta_data->>'role')::smallint, p.role) <> coalesce(p.role, 1)
  );

-- trigger：每次 auth.users 插入或 raw_user_meta_data 更新，自动同步到 profiles
create or replace function public.handle_auth_user_profile_sync() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, school_name, role, updated_at, created_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'school_name',
    coalesce((new.raw_user_meta_data->>'role')::smallint, 1),
    now(),
    now()
  )
  on conflict (id) do update set
    full_name   = coalesce(new.raw_user_meta_data->>'full_name', public.profiles.full_name),
    school_name = coalesce(new.raw_user_meta_data->>'school_name', public.profiles.school_name),
    role        = coalesce((new.raw_user_meta_data->>'role')::smallint, public.profiles.role, 1),
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

-- ----------------------------------------------------------------
-- 2) 新的 RLS：邀请/连接 表本身
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- 3) 收紧 learning_sessions / signals / daily_checkins / mentor_feedback 可见性
-- ----------------------------------------------------------------

-- profiles：本人可见 + 老师可见（用于邀请列表）
alter table public.profiles enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid() or public.is_mentor());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

-- --------------------
-- learning_sessions
-- --------------------
alter table public.learning_sessions enable row level security;

drop policy if exists sessions_select on public.learning_sessions;
create policy sessions_select on public.learning_sessions for select using (
  student_id = auth.uid()
  or public.is_connected_teacher_of(student_id)
);

drop policy if exists sessions_write on public.learning_sessions;
create policy sessions_write on public.learning_sessions
  for insert to public with check (student_id = auth.uid());

drop policy if exists sessions_update on public.learning_sessions;
create policy sessions_update on public.learning_sessions
  for update to public using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- --------------------
-- signals（如存在才处理）
-- --------------------
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

-- --------------------
-- daily_checkins（如存在才处理）
-- --------------------
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

-- --------------------
-- student_courses（如存在才处理）
-- --------------------
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

-- --------------------
-- mentor_feedback（如存在才处理）
-- --------------------
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

-- 完成

-- ================================================================
-- 编辑 & 软删除（courses/chapters/units/learning_sessions）
-- ================================================================

-- 1) 为 chapters / units 添加 deleted_at 软删除字段（courses 已存在）
alter table if exists public.chapters add column if not exists deleted_at timestamptz;
alter table if exists public.units    add column if not exists deleted_at timestamptz;

-- 2) courses：作者 / 导师可 update（含软删除）
drop policy if exists courses_delete_own on public.courses;
drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses for update to public
  using (created_by = auth.uid() or public.is_mentor())
  with check (created_by = auth.uid() or public.is_mentor());

-- 3) chapters：课程作者 / 导师可 update（含软删除）
drop policy if exists chapters_update on public.chapters;
create policy chapters_update on public.chapters for update to public
  using (
    exists (select 1 from public.courses c where c.id = public.chapters.course_id
            and (c.created_by = auth.uid() or public.is_mentor()))
  )
  with check (
    exists (select 1 from public.courses c where c.id = public.chapters.course_id
            and (c.created_by = auth.uid() or public.is_mentor()))
  );

-- 4) units：课程作者 / 导师可 update（含软删除）
drop policy if exists units_update on public.units;
create policy units_update on public.units for update to public
  using (
    exists (select 1 from public.chapters c where c.id = public.units.chapter_id
            and exists (select 1 from public.courses cc where cc.id = c.course_id
                         and (cc.created_by = auth.uid() or public.is_mentor())))
  )
  with check (
    exists (select 1 from public.chapters c where c.id = public.units.chapter_id
            and exists (select 1 from public.courses cc where cc.id = c.course_id
                         and (cc.created_by = auth.uid() or public.is_mentor())))
  );

-- 5) learning_sessions：学生自己 update / 软删除自己的记录
drop policy if exists sessions_update on public.learning_sessions;
create policy sessions_update on public.learning_sessions
  for update to public using (student_id = auth.uid())
  with check (student_id = auth.uid());

