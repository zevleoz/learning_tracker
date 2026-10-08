-- ================================================================
-- GPA Tracker Schema v2.2  【 生产环境初始化 / 重置结构时运行 】
--   - 会先 DROP 所有旧表、函数、触发器、策略（级联）
--   - 然后按 v2 结构重建：课程 → 章节 → 单元 → 知识点
--   - 课程类型：course_type (1=校内, 2=校外)
--   - 字段都是 smallint / varchar(xx)；notes/material_url 最长 500
--   - 软删除用 deleted_at；信号通过 refresh_signals_for() 预计算
--   - 角色：1=student, 2=mentor, 3=admin
--   - is_mentor() 函数统一从 profiles 表读取，确保老师端登录正常
-- ================================================================

-- ----------------------------------------------------------------
-- 0. 清理（如果你想保留旧数据，请先备份！）
-- ----------------------------------------------------------------

drop table if exists public.signals            cascade;
drop table if exists public.mentor_feedback    cascade;
drop table if exists public.daily_checkins     cascade;
drop table if exists public.learning_sessions   cascade;
drop table if exists public.student_courses     cascade;
drop table if exists public.concepts            cascade;
drop table if exists public.units               cascade;
drop table if exists public.chapters            cascade;
drop table if exists public.courses             cascade;
drop table if exists public.profiles            cascade;
drop table if exists public.schools             cascade;

drop function if exists public.refresh_signals_for(uuid, uuid)   cascade;
drop function if exists public.signals_trigger()                  cascade;
drop function if exists public.handle_new_user()                  cascade;
drop function if exists public.is_mentor()                        cascade;
drop function if exists public.is_connected_teacher_of(uuid)      cascade;
drop function if exists public.current_user_id()                  cascade;

-- ----------------------------------------------------------------
-- 1. 工具函数（角色判定）
-- ----------------------------------------------------------------

create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce((select p.role >= 2 from public.profiles p where p.id = auth.uid()), false);
$$;

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

create or replace function public.current_user_id() returns uuid
language sql stable as $$
  select auth.uid();
$$;

-- ----------------------------------------------------------------
-- 2. 学校 / 档案 / 课程
-- ----------------------------------------------------------------

create table public.schools (
  id uuid default gen_random_uuid() primary key,
  name varchar(100) not null,
  created_at timestamptz default now()
);

create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  role smallint not null default 1,
  full_name varchar(100),
  school_id uuid references public.schools(id) on delete set null,
  school_name varchar(100),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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

  insert into public.profiles (id, role, full_name, school_id, school_name)
  values (new.id, v_role, v_full_name, v_school_id, v_school_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.courses (
  id uuid default gen_random_uuid() primary key,
  school_id uuid references public.schools(id) on delete set null,
  name varchar(100) not null,
  subject varchar(50) not null default '',
  course_type smallint not null default 1,
  source smallint not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  is_shared boolean default false,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.chapters (
  id uuid default gen_random_uuid() primary key,
  course_id uuid references public.courses(id) on delete cascade not null,
  name varchar(100) not null,
  order_idx smallint not null default 0,
  created_at timestamptz default now()
);

create table public.units (
  id uuid default gen_random_uuid() primary key,
  chapter_id uuid references public.chapters(id) on delete cascade not null,
  name varchar(100) not null,
  order_idx smallint not null default 0,
  created_at timestamptz default now()
);

create table public.concepts (
  id uuid default gen_random_uuid() primary key,
  unit_id uuid references public.units(id) on delete cascade not null,
  name varchar(100) not null,
  order_idx smallint not null default 0,
  created_at timestamptz default now()
);

create table public.student_courses (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  course_id uuid references public.courses(id) on delete cascade not null,
  status smallint default 1,
  enrolled_at timestamptz default now(),
  unique (student_id, course_id)
);

-- ----------------------------------------------------------------
-- 3. 核心：学习记录 / 打卡 / 反馈
-- ----------------------------------------------------------------

create table public.learning_sessions (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  course_id uuid references public.courses(id) on delete cascade not null,
  chapter_id uuid references public.chapters(id) on delete set null,
  unit_id   uuid references public.units(id)    on delete set null,
  concept_id uuid references public.concepts(id) on delete set null,

  category smallint not null,
  form     varchar(50) not null,
  eval_type smallint not null default 1,

  self_rating smallint check (self_rating in (20,40,60,80,100)),
  grade_label varchar(5),
  score smallint check (score between 0 and 100),

  duration_minutes smallint not null check (duration_minutes > 0),
  notes varchar(500),
  material_url varchar(500),

  session_date date not null,
  start_time time,
  end_time time,

  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.user_learning_forms (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  name varchar(50) not null,
  created_at timestamptz default now(),
  unique (student_id, name)
);

create table public.daily_checkins (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  checkin_date date not null,
  has_sessions boolean default true,
  created_at timestamptz default now(),
  unique (student_id, checkin_date)
);

create table public.mentor_feedback (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  mentor_id uuid references public.profiles(id) on delete cascade not null,
  session_id uuid references public.learning_sessions(id) on delete set null,
  content varchar(500) not null,
  created_at timestamptz default now()
);

create table public.teacher_student_connections (
  id uuid default gen_random_uuid() primary key,
  teacher_id uuid references public.profiles(id) on delete cascade not null,
  student_id uuid references public.profiles(id) on delete cascade not null,
  status smallint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (teacher_id, student_id)
);

-- ----------------------------------------------------------------
-- 4. 信号（预计算）：1=hesitant 2=slow 3=growth 4=stable
-- ----------------------------------------------------------------

create table public.signals (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references public.profiles(id) on delete cascade not null,
  course_id uuid references public.courses(id) on delete cascade not null,
  chapter_id uuid references public.chapters(id) on delete cascade,
  unit_id   uuid references public.units(id)    on delete cascade,
  signal_type smallint not null,
  confidence smallint not null check (confidence between 1 and 100),
  reason varchar(200),
  calculated_at timestamptz default now(),
  expires_at timestamptz not null,
  unique (student_id, course_id, chapter_id, unit_id, signal_type)
);

create or replace function public.refresh_signals_for(sid uuid, cid uuid) returns void
language plpgsql as $$
declare
  row record;
  v_avg_all numeric;
  v_total   integer;
  v_low_rating integer;
  v_low_score  integer;
  v_always_low_score integer;
  v_last_score_delta numeric;
  v_conf smallint;
  v_reason text;
  v_chapter uuid;
  v_unit uuid;
  cursor_chapters cursor for
    select distinct chapter_id, unit_id
    from public.learning_sessions
    where student_id = sid
      and course_id = cid
      and deleted_at is null
      and chapter_id is not null;
begin
  delete from public.signals
  where student_id = sid and course_id = cid;

  open cursor_chapters;
  loop
    fetch cursor_chapters into v_chapter, v_unit;
    exit when not found;

    select count(*), avg(score)
    into v_total, v_avg_all
    from public.learning_sessions
    where student_id = sid and course_id = cid
      and chapter_id = v_chapter
      and deleted_at is null;

    if v_total < 3 then continue; end if;

    select sum(case when self_rating <= 50 then 1 else 0 end)::integer,
           sum(case when score is not null and score < 60 then 1 else 0 end)::integer
    into v_low_rating, v_low_score
    from public.learning_sessions
    where student_id = sid and course_id = cid
      and chapter_id = v_chapter and deleted_at is null;

    select count(*)
    into v_always_low_score
    from (select score from public.learning_sessions
          where student_id = sid and course_id = cid
            and chapter_id = v_chapter and deleted_at is null
            and score is not null
          order by session_date desc, created_at desc
          limit 4) recent
    where score < 70;

    select case when count(distinct score) >= 2
                 then max(score)::numeric - min(score)::numeric
                 else 0 end
    into v_last_score_delta
    from (select score from public.learning_sessions
          where student_id = sid and course_id = cid
            and chapter_id = v_chapter and deleted_at is null
            and score is not null
          order by session_date desc, created_at desc
          limit 4) recent4;

    v_conf := 30 + least(60, (coalesce(v_low_rating,0) + coalesce(v_low_score,0)) * 15);
    v_reason := '该章节多次出现低自评 / 低分：低自评 ' || coalesce(v_low_rating,0) || ' 次，低分 ' || coalesce(v_low_score,0) || ' 次';
    if (coalesce(v_low_rating,0) + coalesce(v_low_score,0)) >= 2 then
      insert into public.signals (student_id, course_id, chapter_id, unit_id, signal_type, confidence, reason, expires_at)
      values (sid, cid, v_chapter, v_unit, 1, v_conf, v_reason, now() + interval '7 days')
      on conflict (student_id, course_id, chapter_id, unit_id, signal_type) do update
        set confidence = excluded.confidence, reason = excluded.reason, calculated_at = now(), expires_at = excluded.expires_at;
    end if;

    if coalesce(v_always_low_score,0) >= 4 then
      v_conf := 40 + least(50, v_always_low_score * 12);
      v_reason := '最近 4 次在该章节的分数都 <70，持续偏低';
      insert into public.signals (student_id, course_id, chapter_id, unit_id, signal_type, confidence, reason, expires_at)
      values (sid, cid, v_chapter, v_unit, 2, v_conf, v_reason, now() + interval '7 days')
      on conflict (student_id, course_id, chapter_id, unit_id, signal_type) do update
        set confidence = excluded.confidence, reason = excluded.reason, calculated_at = now(), expires_at = excluded.expires_at;
    end if;

    if coalesce(v_last_score_delta,0) >= 10 then
      v_conf := 40 + least(50, v_last_score_delta::integer * 3);
      v_reason := '最近 4 次在该章节的分数提升 ≥ ' || v_last_score_delta::text || ' 分';
      insert into public.signals (student_id, course_id, chapter_id, unit_id, signal_type, confidence, reason, expires_at)
      values (sid, cid, v_chapter, v_unit, 3, v_conf, v_reason, now() + interval '7 days')
      on conflict (student_id, course_id, chapter_id, unit_id, signal_type) do update
        set confidence = excluded.confidence, reason = excluded.reason, calculated_at = now(), expires_at = excluded.expires_at;
    end if;

  end loop;
  close cursor_chapters;
end;
$$;

create or replace function public.signals_trigger() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_signals_for(old.student_id, old.course_id);
    return old;
  else
    perform public.refresh_signals_for(new.student_id, new.course_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_refresh_signals on public.learning_sessions;
create trigger trg_refresh_signals
  after insert or update or delete on public.learning_sessions
  for each row execute function public.signals_trigger();

-- ----------------------------------------------------------------
-- 5. 索引
-- ----------------------------------------------------------------

create index idx_sessions_student_date on public.learning_sessions(student_id, session_date desc);
create index idx_sessions_course     on public.learning_sessions(course_id);
create index idx_sessions_chapter    on public.learning_sessions(chapter_id);
create index idx_signals_student     on public.signals(student_id, expires_at);
create index idx_chapters_course     on public.chapters(course_id, order_idx);
create index idx_units_chapter       on public.units(chapter_id, order_idx);
create index idx_concepts_unit       on public.concepts(unit_id, order_idx);
create index idx_checkins_student    on public.daily_checkins(student_id, checkin_date desc);

create index idx_sessions_student_course_chapter 
on public.learning_sessions(student_id, course_id, chapter_id)
where deleted_at is null;
create index idx_sessions_student_course 
on public.learning_sessions(student_id, course_id)
where deleted_at is null;
create index idx_profiles_school_role on public.profiles(school_id, role);
create index idx_feedback_student_mentor 
on public.mentor_feedback(student_id, mentor_id);
create index idx_courses_course_type  on public.courses(course_type);
create index idx_connections_teacher  on public.teacher_student_connections(teacher_id, status);
create index idx_connections_student  on public.teacher_student_connections(student_id, status);

-- ----------------------------------------------------------------
-- 6. RLS / Policies
-- ----------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.courses          enable row level security;
alter table public.chapters         enable row level security;
alter table public.units            enable row level security;
alter table public.concepts         enable row level security;
alter table public.student_courses  enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.daily_checkins    enable row level security;
alter table public.mentor_feedback   enable row level security;
alter table public.signals           enable row level security;
alter table public.user_learning_forms enable row level security;
alter table public.teacher_student_connections enable row level security;

-- profiles：学生看自己，导师看所有人
drop policy if exists profiles_select_self_or_mentor on public.profiles;
create policy profiles_select_self_or_mentor on public.profiles
  for select using (id = auth.uid() or public.is_mentor());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

-- courses：导师/作者可写；所有人可看同校所有课程或自己创建的课程
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses for select using (
  created_by = auth.uid() or
  public.is_mentor() or
  school_id is not null and school_id = (
    select p.school_id from public.profiles p where p.id = auth.uid()
  )
);

drop policy if exists courses_write on public.courses;
create policy courses_write on public.courses for insert to public
  with check (created_by = auth.uid());

drop policy if exists courses_update_own on public.courses;
create policy courses_update_own on public.courses for update to public
  using (created_by = auth.uid() or public.is_mentor())
  with check (created_by = auth.uid() or public.is_mentor());

-- chapters / units / concepts：只要能读到课程就能读
drop policy if exists chapters_select on public.chapters;
create policy chapters_select on public.chapters for select using (
  exists (select 1 from public.courses c where c.id = public.chapters.course_id)
);

drop policy if exists chapters_write on public.chapters;
create policy chapters_write on public.chapters for insert to public
  with check (
    exists (select 1 from public.courses c where c.id = public.chapters.course_id
            and (c.created_by = auth.uid() or public.is_mentor()))
  );

drop policy if exists units_select on public.units;
create policy units_select on public.units for select using (
  exists (select 1 from public.chapters c where c.id = public.units.chapter_id)
);

drop policy if exists units_write on public.units;
create policy units_write on public.units for insert to public
  with check (
    exists (select 1 from public.chapters c where c.id = public.units.chapter_id
            and exists (select 1 from public.courses cc where cc.id = c.course_id
                       and (cc.created_by = auth.uid() or public.is_mentor())))
  );

drop policy if exists concepts_select on public.concepts;
create policy concepts_select on public.concepts for select using (
  exists (select 1 from public.units u where u.id = public.concepts.unit_id)
);

-- student_courses：学生看自己的选课
drop policy if exists student_courses_select on public.student_courses;
create policy student_courses_select on public.student_courses
  for select using (student_id = auth.uid() or public.is_mentor());

drop policy if exists student_courses_write on public.student_courses;
create policy student_courses_write on public.student_courses
  for insert to public with check (student_id = auth.uid());

-- learning_sessions：学生写自己、读自己；导师读已连接学生的数据
drop policy if exists sessions_select_access on public.learning_sessions;
create policy sessions_select_access on public.learning_sessions
  for select using (student_id = auth.uid() or public.is_connected_teacher_of(student_id));

drop policy if exists sessions_write on public.learning_sessions;
create policy sessions_write on public.learning_sessions
  for insert to public with check (student_id = auth.uid());

drop policy if exists sessions_update on public.learning_sessions;
create policy sessions_update on public.learning_sessions
  for update to public using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- daily_checkins：学生自己
drop policy if exists checkins_select on public.daily_checkins;
create policy checkins_select on public.daily_checkins
  for select using (student_id = auth.uid() or public.is_mentor());

drop policy if exists checkins_write on public.daily_checkins;
create policy checkins_write on public.daily_checkins
  for insert to public with check (student_id = auth.uid());

-- user_learning_forms：看自己 / 写自己
drop policy if exists user_forms_select on public.user_learning_forms;
create policy user_forms_select on public.user_learning_forms
  for select using (student_id = auth.uid());
drop policy if exists user_forms_write on public.user_learning_forms;
create policy user_forms_write on public.user_learning_forms
  for insert to public with check (student_id = auth.uid());

-- mentor_feedback：导师写（mentor_id = auth.uid）；学生看自己收到的
drop policy if exists feedback_select on public.mentor_feedback;
create policy feedback_select on public.mentor_feedback
  for select using (student_id = auth.uid() or mentor_id = auth.uid() or public.is_mentor());

drop policy if exists feedback_write on public.mentor_feedback;
create policy feedback_write on public.mentor_feedback
  for insert to public with check (mentor_id = auth.uid() and public.is_mentor());

-- signals：学生看自己；导师看已连接学生的
drop policy if exists signals_select on public.signals;
create policy signals_select on public.signals
  for select using (student_id = auth.uid() or public.is_connected_teacher_of(student_id));

-- teacher_student_connections：导师看自己的连接；学生看自己的连接
drop policy if exists connections_select on public.teacher_student_connections;
create policy connections_select on public.teacher_student_connections
  for select using (teacher_id = auth.uid() or student_id = auth.uid());

drop policy if exists connections_write on public.teacher_student_connections;
create policy connections_write on public.teacher_student_connections
  for insert to public with check (teacher_id = auth.uid() and public.is_mentor());

drop policy if exists connections_update on public.teacher_student_connections;
create policy connections_update on public.teacher_student_connections
  for update using (teacher_id = auth.uid() or student_id = auth.uid())
  with check (teacher_id = auth.uid() or student_id = auth.uid());

-- ----------------------------------------------------------------
-- 7. 示例种子数据（可选）
-- ----------------------------------------------------------------
/*
insert into public.schools (id, name) values ('00000000-0000-0000-0000-000000000001', '示例学校')
on conflict do nothing;
*/

-- ================================================================
-- 完成
-- ================================================================
select 'Schema v2.2 初始化完成' as result;