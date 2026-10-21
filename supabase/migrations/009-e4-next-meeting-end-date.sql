-- ================================================================
-- 009 E4 待办：下次会议结束日（支持日期范围）
-- 首次报告的「下次复盘时间」可为 'yyyy-MM-dd~yyyy-MM-dd' 范围。
-- next_meeting_date 存起始日（分桶 / 排序语义不变），
-- next_meeting_end_date 存结束日；单日或未安排时为 NULL。
-- 由用户在 Supabase Dashboard → SQL Editor 整段执行（幂等）。
-- 未执行时前端同步静默降级，不影响报告保存。
-- ================================================================

alter table public.e4_students
  add column if not exists next_meeting_end_date date;

-- 尽力回填：从各学生最新 first/progress 报告的下次复盘范围里取结束日
-- （'yyyy-MM-dd~yyyy-MM-dd'，section07.nextReviewDate 或 p8.reviewDate）
update public.e4_students s
set next_meeting_end_date = r.end_date
from (
  select distinct on (e4_student_id)
    e4_student_id,
    nullif(
      split_part(
        coalesce(
          form_data #>> '{section07,nextReviewDate}',
          form_data #>> '{p8,reviewDate}',
          ''
        ),
        '~',
        2
      ),
      ''
    )::date as end_date
  from public.e4_reports
  where report_type in ('first', 'progress')
    and coalesce(
      form_data #>> '{section07,nextReviewDate}',
      form_data #>> '{p8,reviewDate}',
      ''
    ) ~ '^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$'
  order by e4_student_id, created_at desc
) r
where r.e4_student_id = s.id
  and r.end_date is not null;

-- 验证
select case when exists (select 1 from information_schema.columns
            where table_name = 'e4_students' and column_name = 'next_meeting_end_date')
            then 'PASS next_meeting_end_date 已添加'
            else 'FAIL next_meeting_end_date 缺失' end as check_1;
