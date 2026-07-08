-- ================================================================
-- 完整修复：老师看不到学生、学生看不到邀请的问题
-- ================================================================

-- ================================================================
-- 1. 确保 profiles 表的 RLS 策略正确
-- ================================================================
alter table public.profiles enable row level security;

-- 老师可以查看所有学生（用于老师端学生列表）
-- 学生可以查看给自己发过邀请或已连接的老师（用于邀请列表显示老师姓名）
-- 本人可以查看自己
drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_select_self on public.profiles;
drop policy if exists profiles_select_self_or_mentor on public.profiles;
drop policy if exists profiles_select_self_or_mentor_or_connected on public.profiles;

create policy profiles_select_all_for_mentor on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.profiles p where p.id = auth.uid() and p.role >= 2
    )
    or exists (
      select 1 from public.teacher_student_connections c
      where c.student_id = auth.uid()
        and c.teacher_id = public.profiles.id
    )
  );

-- ================================================================
-- 2. 确保 teacher_student_connections 表的 RLS 策略正确
-- ================================================================
alter table public.teacher_student_connections enable row level security;

-- 老师可以查看自己发出的邀请/连接
-- 学生可以查看发给自己的邀请/连接
drop policy if exists tsc_select on public.teacher_student_connections;
create policy tsc_select_all on public.teacher_student_connections
  for select using (
    teacher_id = auth.uid() or student_id = auth.uid()
  );

-- 老师可以发起邀请（插入记录）
drop policy if exists tsc_insert_teacher on public.teacher_student_connections;
create policy tsc_insert_teacher on public.teacher_student_connections
  for insert with check (
    teacher_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role >= 2)
    and student_id <> auth.uid()
  );

-- 学生可以接受/拒绝邀请（更新状态）
drop policy if exists tsc_update_student on public.teacher_student_connections;
create policy tsc_update_student on public.teacher_student_connections
  for update using (student_id = auth.uid())
  with check (student_id = auth.uid() and status in (1, 2));

-- ================================================================
-- 3. 确保学习记录表的 RLS 策略正确（老师可以查看已连接学生的数据）
-- ================================================================
alter table public.learning_sessions enable row level security;

drop policy if exists sessions_select_student on public.learning_sessions;
drop policy if exists sessions_select_connected_teacher on public.learning_sessions;

create policy sessions_select_student_or_connected_teacher on public.learning_sessions
  for select using (
    student_id = auth.uid()
    or exists (
      select 1 from public.teacher_student_connections c
      where c.teacher_id = auth.uid()
        and c.student_id = public.learning_sessions.student_id
        and c.status = 1
    )
  );

-- ================================================================
-- 4. 确保 is_mentor() 函数存在且正确
-- ================================================================
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

-- ================================================================
-- 5. 确保 teacher_student_connections 表存在且结构正确
-- ================================================================
create table if not exists public.teacher_student_connections (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status smallint not null default 0,
  note varchar(200),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (teacher_id, student_id)
);

-- ================================================================
-- 6. 确保 profiles 表有必要的列
-- ================================================================
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
end $$;

-- 确保所有 null 的 role 都有默认值
update public.profiles set role = 1 where role is null;

-- ================================================================
-- 7. 同步 auth.users 到 profiles（确保 role 正确）
-- ================================================================
update public.profiles p
set role        = coalesce((u.raw_user_meta_data->>'role')::smallint, p.role),
    full_name   = coalesce(u.raw_user_meta_data->>'full_name', p.full_name, u.email),
    school_name = coalesce(u.raw_user_meta_data->>'school_name', p.school_name),
    updated_at  = now()
from auth.users u
where p.id = u.id
  and u.raw_user_meta_data is not null;

-- ================================================================
-- 8. 创建必要的索引
-- ================================================================
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_tsc_teacher on public.teacher_student_connections(teacher_id);
create index if not exists idx_tsc_student on public.teacher_student_connections(student_id);

-- ================================================================
-- 完成
-- ================================================================
select 'RLS 策略修复完成' as result;