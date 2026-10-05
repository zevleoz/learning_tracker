-- ================================================================
-- 启用 learning_sessions 的 Supabase Realtime
-- 用途：导师端（Mentor.jsx）订阅选中学生的学习记录变更，
--       学生提交/修改/删除后导师 dashboard 即刻刷新。
-- 幂等：已加入 publication 时不重复添加。
-- 执行方式：Supabase Dashboard → SQL Editor 手动执行本文件。
-- ================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'learning_sessions'
  ) then
    alter publication supabase_realtime add table public.learning_sessions;
  end if;
end $$;

-- 验证：应返回一行 learning_sessions
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
