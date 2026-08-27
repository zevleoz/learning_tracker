-- ===========================================================
-- 补丁：新增考试成绩表 exam_scores + RLS + 索引
-- 幂等脚本：可重复执行无副作用
-- 部署顺序：先在 Supabase SQL Editor 执行本脚本，再 push 前端到 Vercel
-- ===========================================================

-- ── 1. 建表 ─────────────────────────────────────
create table if not exists public.exam_scores (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  exam_name varchar(64) not null,          -- 如：月考、期末、期中考试、单元测
  exam_date date not null,
  score numeric(5,2),                      -- 百分制分数，可空（可能只有等第）
  grade_label varchar(8),                  -- 等第，如 A+、90、优；可空
  notes text,                              -- 备注，可空
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- ── 2. 索引（deleted_at 过滤的部分索引）────────────────────
create index if not exists idx_exam_scores_student_course
  on public.exam_scores(student_id, course_id)
  where deleted_at is null;

create index if not exists idx_exam_scores_course
  on public.exam_scores(course_id)
  where deleted_at is null;

create index if not exists idx_exam_scores_student_date
  on public.exam_scores(student_id, exam_date desc)
  where deleted_at is null;

-- ── 3. RLS ─────────────────────────────────────
alter table public.exam_scores enable row level security;

-- SELECT：学生本人，或其已连接导师
drop policy if exists "exam_scores_select_own_or_mentor" on public.exam_scores;
create policy "exam_scores_select_own_or_mentor" on public.exam_scores for select
using (
  student_id = auth.uid()
  or (public.is_connected_teacher_of(student_id))
);

-- INSERT：仅本人
drop policy if exists "exam_scores_insert_own" on public.exam_scores;
create policy "exam_scores_insert_own" on public.exam_scores for insert
with check (
  student_id = auth.uid()
);

-- UPDATE：仅本人
drop policy if exists "exam_scores_update_own" on public.exam_scores;
create policy "exam_scores_update_own" on public.exam_scores for update
using ( student_id = auth.uid() )
with check ( student_id = auth.uid() );

-- DELETE：仅本人（软删除用 update 也走 update 策略；本策略兜底硬删除）
drop policy if exists "exam_scores_delete_own" on public.exam_scores;
create policy "exam_scores_delete_own" on public.exam_scores for delete
using ( student_id = auth.uid() );

-- ── 4. updated_at 触发器 ───────────────────────
create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_exam_scores on public.exam_scores;
create trigger set_timestamp_exam_scores
before update on public.exam_scores
for each row execute function public.trigger_set_timestamp();

-- ===========================================================
-- 执行完成后的验证 SQL（可选）：
--   select * from public.exam_scores limit 0;     -- 表结构 OK
--   select rowsecurity from pg_tables where tablename='exam_scores'; -- 应返回 t
-- ===========================================================
