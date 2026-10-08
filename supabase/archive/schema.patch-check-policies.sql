-- ================================================================
-- 检查 learning_sessions 表的当前 RLS 策略
-- ================================================================

-- 查看所有策略
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where tablename = 'learning_sessions';

-- 查看表的 RLS 状态
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'learning_sessions';

-- ================================================================
-- 如果需要，强制重新创建策略
-- ================================================================

-- 先删除所有相关策略
drop policy if exists sessions_select_access on public.learning_sessions;
drop policy if exists sessions_select_mentor_access on public.learning_sessions;
drop policy if exists sessions_select_student on public.learning_sessions;
drop policy if exists sessions_select_student_or_connected_teacher on public.learning_sessions;

drop policy if exists sessions_insert on public.learning_sessions;
drop policy if exists sessions_write on public.learning_sessions;

drop policy if exists sessions_update on public.learning_sessions;

drop policy if exists sessions_delete on public.learning_sessions;

-- 重新创建所有策略
create policy sessions_select_access on public.learning_sessions
  for select using (
    student_id = auth.uid()
    or public.is_connected_teacher_of(student_id)
  );

create policy sessions_insert on public.learning_sessions
  for insert to public with check (student_id = auth.uid());

create policy sessions_update on public.learning_sessions
  for update to public using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy sessions_delete on public.learning_sessions
  for delete using (student_id = auth.uid());

-- 完成
select 'learning_sessions RLS 策略检查并重建完成' as result;
