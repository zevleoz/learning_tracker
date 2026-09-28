-- ============================================================
-- E4 待办事项：在 e4_students 上冗余「下次会议」信息
-- next_meeting_type: 'first'（首次会议）| 'progress'（进程中复盘）
-- next_meeting_date 为 NULL 表示待安排
-- 在 Supabase SQL Editor 执行
-- ============================================================

alter table public.e4_students
  add column if not exists next_meeting_date date,
  add column if not exists next_meeting_type text
    check (next_meeting_type in ('first', 'progress'));

-- 已有学生：还没有任何首次报告的视为待首次会议
update public.e4_students
set next_meeting_type = 'first'
where next_meeting_type is null;

-- 已有首次报告的学生：回填最近一次报告的下次复盘时间
update public.e4_students s
set
  next_meeting_type = 'progress',
  next_meeting_date = nullif(r.form_data #>> '{section07,nextReviewDate}', '')::date
from (
  select distinct on (e4_student_id)
    e4_student_id, form_data
  from public.e4_reports
  where report_type in ('first', 'progress')
    and form_data #>> '{section07,nextReviewDate}' ~ '^\d{4}-\d{2}-\d{2}$'
  order by e4_student_id, created_at desc
) r
where r.e4_student_id = s.id;
