-- ================================================================
-- E4 学习力导师平台 · Phase 1
-- 一表人才 / E4 首次学习力分析报告
--
-- Adds:
--   1. profiles.default_workspace ('e4' 默认 | 'tracker')
--   2. public.e4_students      —— E4 学生中心档案（手动建档、手动关联 Y4）
--   3. public.e4_reports       —— E4 报告（本期仅 report_type='first'）
--
-- 权限：仅 role >= 2（导师/管理员）可读写 E4 两张表；学生零访问。
-- Idempotent: safe to re-run. Run AFTER schema.sql and existing patches.
-- ================================================================

-- ----------------------------------------------------------------
-- 0. 通用 updated_at 触发器（若不存在）
-- ----------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------
-- 1. profiles.default_workspace
-- ----------------------------------------------------------------
alter table public.profiles
  add column if not exists default_workspace varchar(16) not null default 'e4';

alter table public.profiles
  drop constraint if exists profiles_default_workspace_check;
alter table public.profiles
  add constraint profiles_default_workspace_check
  check (default_workspace in ('e4', 'tracker'));

-- default_workspace 仅允许本人更新（复用 profiles_update_self 策略；
-- guard_profile_role 只锁 role 列，无需额外触发器）。

-- ----------------------------------------------------------------
-- 2. e4_students
-- ----------------------------------------------------------------
create table if not exists public.e4_students (
  id                 uuid primary key default gen_random_uuid(),
  display_name       varchar(100) not null,
  gender             varchar(10),
  grade              varchar(30),
  school             varchar(100),
  advisor_id         uuid references public.profiles(id) on delete set null,
  -- 手动关联的 Y4 系统身份（Y4 为独立数据库，不设外键）
  y4_student_id      integer,
  y4_report_id       integer,
  y4_student_name    varchar(100),
  y4_report_date     date,
  -- 可选关联一表人才学生（过程中报告使用，本期不强制）
  tracker_profile_id uuid references public.profiles(id) on delete set null,
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_e4_students_advisor on public.e4_students(advisor_id);
create index if not exists idx_e4_students_y4 on public.e4_students(y4_student_id, y4_report_id);

drop trigger if exists trg_e4_students_updated on public.e4_students;
create trigger trg_e4_students_updated
  before update on public.e4_students
  for each row execute function public.set_updated_at();

alter table public.e4_students enable row level security;

drop policy if exists e4_students_select on public.e4_students;
create policy e4_students_select on public.e4_students
  for select using (public.is_mentor());

drop policy if exists e4_students_insert on public.e4_students;
create policy e4_students_insert on public.e4_students
  for insert to public
  with check (public.is_mentor());

drop policy if exists e4_students_update on public.e4_students;
create policy e4_students_update on public.e4_students
  for update to public
  using (public.is_mentor())
  with check (public.is_mentor());

-- ----------------------------------------------------------------
-- 3. e4_reports
--    protocol_md 保存拉取时的 E4 协议快照；重开报告不重复调用 Y4 AI。
-- ----------------------------------------------------------------
create table if not exists public.e4_reports (
  id                 uuid primary key default gen_random_uuid(),
  e4_student_id      uuid not null references public.e4_students(id) on delete cascade,
  report_type        varchar(16) not null default 'first',
  status             varchar(10) not null default 'draft',
  meeting_date       date,
  report_date        date,
  report_nature      varchar(100) not null default '首次学习力分析报告',
  minutes_text       text,
  protocol_md        text,
  protocol_fetched_at timestamptz,
  form_data          jsonb not null default '{}'::jsonb,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint e4_reports_type_check check (report_type in ('first', 'progress', 'prep')),
  constraint e4_reports_status_check check (status in ('draft', 'final'))
);

create index if not exists idx_e4_reports_student on public.e4_reports(e4_student_id, created_at desc);

drop trigger if exists trg_e4_reports_updated on public.e4_reports;
create trigger trg_e4_reports_updated
  before update on public.e4_reports
  for each row execute function public.set_updated_at();

alter table public.e4_reports enable row level security;

drop policy if exists e4_reports_select on public.e4_reports;
create policy e4_reports_select on public.e4_reports
  for select using (public.is_mentor());

drop policy if exists e4_reports_insert on public.e4_reports;
create policy e4_reports_insert on public.e4_reports
  for insert to public
  with check (public.is_mentor());

drop policy if exists e4_reports_update on public.e4_reports;
create policy e4_reports_update on public.e4_reports
  for update to public
  using (public.is_mentor())
  with check (public.is_mentor());

drop policy if exists e4_reports_delete on public.e4_reports;
create policy e4_reports_delete on public.e4_reports
  for delete to public
  using (public.is_mentor());

-- ----------------------------------------------------------------
-- 4. report_type 放宽：'prep'（首次学习力会议会前准备）
--    会前准备复用 e4_reports：protocol_md 存协议快照，
--    form_data 存会前专属结构（封面/资料完整性/学科排序/确认清单）。
-- ----------------------------------------------------------------
alter table public.e4_reports
  drop constraint if exists e4_reports_type_check;
alter table public.e4_reports
  add constraint e4_reports_type_check
  check (report_type in ('first', 'progress', 'prep'));

-- ================================================================
select 'E4 phase-1 patch applied' as result;
-- ================================================================
