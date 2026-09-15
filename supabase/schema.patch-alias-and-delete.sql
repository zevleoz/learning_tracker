-- ================================================================
-- Mentor Dashboard Patch: Student Alias + Delete Student
--
-- Adds:
--   1. mentor_alias column on teacher_student_connections
--      (per-mentor private alias for a student; NULL = no alias)
--   2. update_student_alias(uuid, text) RPC — mentor updates alias
--      on an accepted connection. Empty string clears the alias.
--   3. delete_student(uuid) RPC — admin-only hard delete of a
--      student account. Deletes the auth.users row; the existing
--      ON DELETE CASCADE FK from profiles.id → auth.users.id
--      cascades through profiles → learning_sessions,
--      teacher_student_connections, mentor_feedback,
--      student_courses, daily_checkins, user_learning_forms, signals.
--
-- Idempotent: safe to re-run.
-- Run order: AFTER schema.sql and existing patches.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. mentor_alias column on teacher_student_connections
-- ----------------------------------------------------------------
alter table public.teacher_student_connections
  add column if not exists mentor_alias varchar(100);

-- ----------------------------------------------------------------
-- 2. update_student_alias(uuid, text) — SECURITY DEFINER RPC
--    Mirrors update_student_school in schema.patch-profile-edit-and-rls.sql
-- ----------------------------------------------------------------
create or replace function public.update_student_alias(
  p_student_id uuid,
  p_alias text
) returns void
language plpgsql security definer as $$
declare
  v_alias text;
begin
  if not public.is_mentor() then
    raise exception 'Only mentors can update student alias' using errcode = '42501';
  end if;

  -- Require an accepted connection (status=1) between caller and student.
  -- Admin's auto-connections are status=1, so admins are covered.
  if not exists (
    select 1 from public.teacher_student_connections c
    where c.teacher_id = auth.uid()
      and c.student_id = p_student_id
      and c.status = 1
  ) then
    raise exception 'No accepted connection with this student' using errcode = '42501';
  end if;

  -- Trim whitespace. Empty/whitespace alias => NULL (clears alias).
  v_alias := nullif(trim(coalesce(p_alias, '')), '');

  update public.teacher_student_connections
    set mentor_alias = v_alias,
        updated_at   = now()
    where teacher_id = auth.uid()
      and student_id = p_student_id;
end;
$$;

revoke all on function public.update_student_alias(uuid, text) from public;
grant execute on function public.update_student_alias(uuid, text) to authenticated;

-- ----------------------------------------------------------------
-- 3. delete_student(uuid) — admin-only hard delete
--    Deletes the auth.users row; cascade drops profiles + all
--    student-owned rows in dependent tables.
-- ----------------------------------------------------------------
create or replace function public.delete_student(
  p_student_id uuid
) returns uuid
language plpgsql security definer as $$
declare
  v_target_role smallint;
  v_deleted_id  uuid := null;
begin
  -- Admin-only
  if not public.is_admin() then
    raise exception 'Only admins can delete students' using errcode = '42501';
  end if;

  -- Refuse self-delete
  if p_student_id = auth.uid() then
    raise exception 'Cannot delete your own account' using errcode = '42501';
  end if;

  -- Target must be a student (role = 1). Refuse mentors/admins.
  select p.role into v_target_role
    from public.profiles p where p.id = p_student_id;
  if v_target_role is null then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  if v_target_role <> 1 then
    raise exception 'Target is not a student (role=%). Only students can be deleted.', v_target_role
      using errcode = '42501';
  end if;

  -- Delete from auth.users. The FK profiles.id → auth.users ON DELETE CASCADE
  -- will cascade through profiles and all dependent tables.
  delete from auth.users where id = p_student_id returning id into v_deleted_id;

  if v_deleted_id is null then
    -- Profile existed but auth.users row was already gone. Manually clean up
    -- the profile row so the UI doesn't keep showing a ghost student.
    delete from public.profiles where id = p_student_id;
  end if;

  return p_student_id;
end;
$$;

revoke all on function public.delete_student(uuid) from public;
grant execute on function public.delete_student(uuid) to authenticated;

-- ================================================================
select 'Alias + delete-student patch applied' as result;
-- ================================================================
