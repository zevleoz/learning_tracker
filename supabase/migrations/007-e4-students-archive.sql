-- ================================================================
-- 007 E4 学生软归档（E4-2）
-- 误建档的学生不硬删除：加 archived_at 软归档，列表默认过滤，
-- 提供归档/恢复两个 RPC（is_mentor 权限内，导师可归档自己的学生，
-- admin 可归档任意学生；恢复仅 admin）。
-- 由用户在 Supabase Dashboard → SQL Editor 整段执行（幂等）。
-- ================================================================

alter table public.e4_students
  add column if not exists archived_at timestamptz;

-- 归档：导师归档自己创建的学生，admin 归档任意学生
create or replace function public.archive_e4_student(p_student_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_is_admin boolean;
  v_created_by uuid;
begin
  if not public.is_mentor() then
    raise exception 'Only mentors can archive students' using errcode = '42501';
  end if;

  select created_by into v_created_by
    from public.e4_students where id = p_student_id;
  if v_created_by is null or v_created_by <> auth.uid() then
    select public.is_admin() into v_is_admin;
    if not v_is_admin then
      raise exception 'Only the creating mentor or an admin can archive this student' using errcode = '42501';
    end if;
  end if;

  update public.e4_students
    set archived_at = now()
    where id = p_student_id and archived_at is null;
end;
$$;

-- 恢复：仅 admin
create or replace function public.unarchive_e4_student(p_student_id uuid)
returns void
language plpgsql security definer as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can restore archived students' using errcode = '42501';
  end if;
  update public.e4_students
    set archived_at = null
    where id = p_student_id;
end;
$$;

revoke all on function public.archive_e4_student(uuid) from public;
revoke all on function public.unarchive_e4_student(uuid) from public;
grant execute on function public.archive_e4_student(uuid) to authenticated;
grant execute on function public.unarchive_e4_student(uuid) to authenticated;

-- 验证
select case when exists (select 1 from information_schema.columns
            where table_name = 'e4_students' and column_name = 'archived_at')
            then 'PASS archived_at 已添加'
            else 'FAIL archived_at 缺失' end as check_1;