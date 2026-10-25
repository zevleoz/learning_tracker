-- ================================================================
-- 导师 ↔ 学生连接：修复「断开连接没生效」「无法再次邀请」，并收紧直接建连
-- 幂等，可重复执行。在 Supabase SQL Editor 中执行。
-- ================================================================

-- ----------------------------------------------------------------
-- 0) 先只读检查当前策略（单独执行这一句，确认后再执行下面的部分）
--    预期：没有允许老师 UPDATE 的策略（所以断开连接不会生效），
--          tsc_insert_teacher 的 with_check 里没有限制 status。
-- ----------------------------------------------------------------
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'teacher_student_connections';

-- ----------------------------------------------------------------
-- 1) 普通导师只能发邀请（status 0）；只有 admin（role >= 3）可以直接建立连接
--    之前任何导师账号都能直接写入 status = 1，绕过学生同意读取记录。
-- ----------------------------------------------------------------
drop policy if exists tsc_insert_teacher on public.teacher_student_connections;
create policy tsc_insert_teacher on public.teacher_student_connections for insert to public
with check (
  teacher_id = auth.uid()
  and public.is_mentor()
  and student_id <> auth.uid()
  and (
    status = 0
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role >= 3)
  )
);

-- ----------------------------------------------------------------
-- 2) 断开连接：status 1 → 2。没有改到行时报错，前端不会再显示「已断开」的假成功。
-- ----------------------------------------------------------------
create or replace function public.mentor_disconnect(p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mentor() then
    raise exception '仅导师可操作';
  end if;
  update public.teacher_student_connections
     set status = 2, updated_at = now()
   where teacher_id = auth.uid() and student_id = p_student and status = 1;
  if not found then
    raise exception '没有找到已连接的这位学生';
  end if;
end $$;

-- ----------------------------------------------------------------
-- 3) 再次邀请：已拒绝 / 已断开（status 2）→ 邀请中（status 0）。
--    之前前端会再插入一行，撞上 unique(teacher_id, student_id) 而失败。
-- ----------------------------------------------------------------
create or replace function public.mentor_reinvite(p_student uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mentor() then
    raise exception '仅导师可操作';
  end if;
  update public.teacher_student_connections
     set status = 0, note = left(coalesce(p_note, ''), 200), updated_at = now()
   where teacher_id = auth.uid() and student_id = p_student and status = 2;
  if not found then
    raise exception '这位学生当前不能重新邀请';
  end if;
end $$;

revoke all on function public.mentor_disconnect(uuid) from public;
revoke all on function public.mentor_reinvite(uuid, text) from public;
grant execute on function public.mentor_disconnect(uuid) to authenticated;
grant execute on function public.mentor_reinvite(uuid, text) to authenticated;

-- ----------------------------------------------------------------
-- 4) 验证（只读）
-- ----------------------------------------------------------------
-- select policyname, with_check from pg_policies
--  where schemaname = 'public' and tablename = 'teacher_student_connections' and policyname = 'tsc_insert_teacher';
-- select proname from pg_proc where proname in ('mentor_disconnect', 'mentor_reinvite');
