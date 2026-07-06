-- ================================================================
-- 索引优化补丁
-- 用于加速信号计算、查询性能
-- ================================================================

-- 1. 信号计算核心索引（最常用查询模式）
-- 覆盖: student_id = sid AND course_id = cid AND chapter_id = v_chapter AND deleted_at IS NULL
create index if not exists idx_sessions_student_course_chapter 
on public.learning_sessions(student_id, course_id, chapter_id)
where deleted_at is null;

-- 2. 学生+课程组合索引（用于课程统计）
-- 覆盖: student_id = sid AND course_id = cid AND deleted_at IS NULL
create index if not exists idx_sessions_student_course 
on public.learning_sessions(student_id, course_id)
where deleted_at is null;

-- 3. profiles 学校+角色索引（用于导师筛选学生）
-- 覆盖: school_id = xxx AND role = xxx
create index if not exists idx_profiles_school_role 
on public.profiles(school_id, role);

-- 4. profiles 邮箱索引（用于登录查询）
-- 注意：email 存储在 auth.users 表中，profiles 表无 email 字段
-- 登录查询由 Supabase Auth 内部处理，无需在此建索引

-- 5. mentor_feedback 学生+导师索引
-- 覆盖: student_id = xxx AND mentor_id = xxx
create index if not exists idx_feedback_student_mentor 
on public.mentor_feedback(student_id, mentor_id);

-- ================================================================
-- 完成
-- ================================================================