-- ================================================================
-- 诊断：学习记录更新问题
-- ================================================================

-- 1. 查看当前登录用户
select auth.uid() as current_user_id, auth.role() as current_role;

-- 2. 查看 learning_sessions 表结构
\d public.learning_sessions;

-- 3. 查看当前用户的学习记录（验证是否能看到自己的数据）
select id, student_id, session_date, duration_minutes, form, created_at
from public.learning_sessions
where student_id = auth.uid()
order by created_at desc
limit 10;

-- 4. 测试更新一条记录（替换 ID 为实际存在的记录 ID）
-- UPDATE public.learning_sessions 
-- SET duration_minutes = duration_minutes + 1
-- WHERE id = 'REPLACE_WITH_ACTUAL_RECORD_ID' AND student_id = auth.uid();

-- 5. 查看 profiles 表中当前用户的角色
select * from public.profiles where id = auth.uid();

-- 6. 检查 is_mentor 函数是否存在
select public.is_mentor();

-- 7. 检查 RLS 策略
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where tablename = 'learning_sessions';
