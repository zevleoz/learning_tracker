-- ================================================================
-- 添加课程类型字段（校内/校外）
-- ================================================================

-- 添加 course_type 字段（1=校内，2=校外，默认1=校内）
alter table if exists public.courses add column if not exists course_type smallint default 1;

-- 创建索引
create index if not exists courses_course_type_idx on public.courses(course_type);

-- 更新现有数据的 course_type（保留向后兼容）
-- 对于已有数据，如果 subject 为空，设置为默认值
-- 如果已有 subject，不做改动（保留原有数据）

-- 完成
select 'course_type 字段添加完成' as result;