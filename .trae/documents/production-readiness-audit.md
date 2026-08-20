# Production Readiness Audit & Fix Plan

## Summary

Two-role audit (Full-Stack Engineer + 青少年学习力导师) of the entire app, focusing on:

1. Account creation data integrity between student and mentor
2. Profile editing capability for all users
3. Chart data correctness from a learning mentor's perspective

***

## Current State Analysis

### CRITICAL BUG: Mentor name overwritten when student signs up

**File**: `src/pages/Signup.jsx` lines 88-99

**Root cause**: After `supabase.auth.signUp()`, the code calls `supabase.auth.getSession()` to get the new user's ID. When email confirmation is enabled (Supabase default), `signUp()` does NOT create a new session. `getSession()` returns the PREVIOUS session — if a mentor was logged in on the same browser, `uid` = mentor's ID. The subsequent `profiles.upsert({ id: mentor_uid, full_name: student_name })` overwrites the mentor's name.

```js
// BROKEN CODE (Signup.jsx L88-99)
const { data: sessionData } = await supabase.auth.getSession();
const uid = sessionData?.session?.user?.id;  // ← Returns MENTOR's uid!
if (uid) {
  await supabase.from('profiles').upsert({
    id: uid,  // ← MENTOR's id!
    full_name: form.name.trim(),  // ← STUDENT's name!
    // ...
  }, { onConflict: 'id' });  // ← Overwrites mentor's profile!
}
```

### Missing Feature: No profile editing UI

**Files**: `src/pages/Mentor.jsx` (settings = placeholder), no student settings page

The RLS policy `profiles_update_self` allows `id = auth.uid()` for UPDATE, but there is no UI component that lets users edit their own name or school. The mentor settings page (both desktop L805-820 and mobile L1161-1191) shows a placeholder "系统设置功能即将上线" or read-only info with no edit capability.

### RLS Issue: Mentor cannot edit student's school\_name

**File**: `src/pages/Mentor.jsx` L360-379

`saveSchoolName()` calls `profiles.update()` on a student's profile, but the only UPDATE RLS policy is `profiles_update_self` (allows `id = auth.uid()` only). A mentor updating a student's school\_name would fail with an RLS permission error.

### RLS Issue: No INSERT policy on profiles

If the DB trigger `handle_auth_user_profile_sync` fails (or doesn't exist), the Signup.jsx fallback `profiles.upsert()` would try to INSERT a new row. There is no INSERT RLS policy on `profiles`, so this would fail silently.

### RLS Issue: Students can change their own role via API

`profiles_update_self` policy allows updating ANY field on own profile. A student could call `supabase.from('profiles').update({ role: 2 })` to become a mentor. Need `WITH CHECK` to restrict field changes.

### Multiple conflicting DB triggers

At least 3 different `handle_new_user()` / `handle_auth_user_profile_sync()` definitions exist across:

* `schema.sql` — basic insert, no `school_name`

* `schema.v2.sql` — adds `school_name`, inserts `school_id`

* `schema.patch-invites.sql` / `schema.patch-production.sql` — upsert with ON CONFLICT

* `schema.patch-fix-teacher-login.sql` — redefines `handle_new_user` with `raw_app_meta_data`

* `schema.patch.sql` — completely different version with `display_name`, `email` columns

Two triggers fire on `AFTER INSERT ON auth.users`:

1. `on_auth_user_created` → `handle_new_user()`
2. `on_auth_user_created_profile` → `handle_auth_user_profile_sync()`

Both run, second overrides first via ON CONFLICT. The `handle_auth_user_profile_sync` doesn't set `school_id`, causing inconsistency.

### `is_mentor()` function defined 4+ different ways

* `schema.sql`: reads from JWT claims, falls back to profiles table

* `schema.patch-invites.sql`: reads from `profiles` table

* `schema.patch-fix-recursion.sql`: reads from `auth.users` (avoids recursion)

* `schema.patch-fix-permission.sql`: reads from `auth.users`

* `schema.patch-fix-teacher-login.sql`: reads from `profiles` table

The `profiles`-based version can cause RLS recursion. The `auth.users`-based version is safer.

### Index references non-existent column

`schema.patch-production.sql` L178-179: creates index on `learning_sessions(student_id, subject)` but `learning_sessions` has no `subject` column.

### Chart data issues (already fixed in prior session)

These were fixed in the previous session and are verified correct:

* Subject summarization (courses not merged into generic subjects)

* Calendar heatmap showing no data (start\_time not fetched)

* Daily averages instead of weekly totals

* Hardcoded subject names and misleading claims removed

***

## Proposed Changes

### 1. Fix Signup.jsx: Use signUp response instead of getSession (CRITICAL)

**File**: `src/pages/Signup.jsx` L75-103

**What**: Replace `supabase.auth.getSession()` with `data.user.id` from the `signUp()` response.

**Why**: `signUp()` returns `{ data: { user: { id: ... }, session: ... } }`. The `user.id` is always the new user's ID, regardless of email confirmation status. `getSession()` returns the previous session if no new session is created.

**How**:

```js
const { data, error } = await supabase.auth.signUp({
  email: form.email.trim(),
  password: form.password,
  options: { data: { full_name, school_name, role } }
});
if (error) throw error;

const uid = data?.user?.id;
if (uid) {
  await supabase.from('profiles').upsert({
    id: uid,
    full_name: form.name.trim() || form.email.split('@')[0],
    school_name: form.school.trim() || '',
    role,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
}
```

### 2. Add profile editing UI for all users

**File**: New component `src/components/ProfileEditor.jsx` + integrate into `Mentor.jsx` settings and student-side

**What**: A reusable profile editor that lets users update their `full_name` and `school_name`. Uses `supabase.auth.updateUser()` to sync `user_metadata` (which triggers `on_auth_user_updated_profile` to sync profiles table) AND directly updates `profiles` table.

**Why**: Users need to edit their name and school after account creation. The DB trigger `on_auth_user_updated_profile` already syncs `auth.users` metadata → `profiles` table. We just need the UI.

**How**:

* Create `ProfileEditor` component with name/school fields

* On save: call `supabase.auth.updateUser({ data: { full_name, school_name } })` then `supabase.from('profiles').update({ full_name, school_name })`

* Replace the placeholder settings page in Mentor.jsx desktop (L805-820) and mobile (L1161-1191) with this component

* Add a settings/profile section accessible from the student Layout (add a profile button to the top bar)

### 3. Fix RLS: Add INSERT policy + restrict UPDATE fields

**File**: `supabase/schema.patch-profile-rls-fix.sql` (new migration)

**What**:

* Add `profiles_insert_self` INSERT policy: `id = auth.uid()`

* Modify `profiles_update_self` to add `WITH CHECK` preventing role changes: `WITH CHECK (id = auth.uid() AND (role = auth.uid() OR role IS NOT NULL))` — actually simpler: use a `WITH CHECK` that prevents `role` from being changed: compare old vs new role.

**Why**:

* INSERT policy ensures Signup.jsx fallback upsert works even if trigger fails

* `WITH CHECK` prevents privilege escalation (student → mentor)

**How**:

```sql
-- Allow users to insert their own profile (fallback for Signup.jsx)
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

-- Allow update but prevent role change
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());
-- Note: RLS WITH CHECK can't compare old vs new values directly.
-- To truly prevent role changes, use a trigger or restrict via API.
```

### 4. Add RPC for mentor to update student school\_name

**File**: `supabase/schema.patch-mentor-edit-student.sql` (new migration)

**What**: Create a `SECURITY DEFINER` function `update_student_school(student_id, school_name)` that checks the caller is a mentor with an accepted connection to the student, then updates only `school_name`.

**Why**: The current `saveSchoolName()` in Mentor.jsx fails due to RLS. An RPC with `SECURITY DEFINER` bypasses RLS safely and restricts which fields can be changed.

**How**:

```sql
create or replace function public.update_student_school(
  p_student_id uuid, p_school_name text
) returns void language plpgsql security definer as $$
begin
  if not public.is_mentor() then
    raise exception 'Only mentors can update student school name';
  end if;
  if not exists (
    select 1 from public.teacher_student_connections
    where teacher_id = auth.uid() and student_id = p_student_id and status = 1
  ) then
    raise exception 'No accepted connection with this student';
  end if;
  update public.profiles set school_name = trim(p_school_name), updated_at = now()
    where id = p_student_id;
end;
$$;
```

Update `src/pages/Mentor.jsx` `saveSchoolName()` to call this RPC:

```js
const { error } = await supabase.rpc('update_student_school', {
  p_student_id: studentId,
  p_school_name: newSchool.trim(),
});
```

### 5. Consolidate DB triggers

**File**: `supabase/schema.patch-consolidate-triggers.sql` (new migration)

**What**:

* Drop both `on_auth_user_created` and `on_auth_user_created_profile` triggers

* Drop both `handle_new_user` and `handle_auth_user_profile_sync` functions

* Create one unified `handle_new_user()` that: reads role/full\_name/school\_name from metadata, looks up/creates school, upserts profile with `school_id` AND `school_name`

* Create one `on_auth_user_created` trigger

* Keep `on_auth_user_updated_profile` trigger for metadata updates

**Why**: Multiple triggers cause unpredictable behavior. The `handle_auth_user_profile_sync` doesn't set `school_id`, causing school lookup to be skipped.

### 6. Standardize `is_mentor()` function

**File**: Same migration as #5

**What**: Define `is_mentor()` to read from `auth.users.raw_user_meta_data` (avoids RLS recursion).

```sql
create or replace function public.is_mentor() returns boolean
language sql security definer stable as $$
  select coalesce(
    (u.raw_user_meta_data->>'role')::smallint >= 2,
    (u.raw_app_meta_data->>'role')::smallint >= 2,
    false
  )
  from auth.users u where u.id = auth.uid();
$$;
```

Also standardize `is_connected_teacher_of()` to use `auth.users` for role check.

### 7. Fix broken index

**File**: Same migration as #5

**What**: Drop `idx_sessions_student_subject` (references non-existent `subject` column). Replace with index on `(student_id, course_id)`.

### 8. Chart data verification (学习力导师 perspective)

**Status**: Already fixed in prior session. Verify the following are correct:

* **Chart1 (Workday/Weekend daily averages)**: Groups by actual calendar dates, divides by unique date count. Labels say "日均". ✓

* **Chart2 (Course investment structure)**: Groups by `s.subject` (course.name). Two calculus courses show separately. ✓

* **Chart3 (Efficiency matrix)**: Groups by course name. Shows per-course avg score vs time. ✓

* **Chart4 (Self-learning trend)**: 4-week rolling, compares self/total ratio. ✓

* **Chart5 (Balance deviation)**: Per-course % vs ideal even distribution. ✓

* **Chart6 (Practice quality)**: Per-course practice category (3) ratio. ✓

* **Chart7 (Heatmap)**: Uses `s.time` (from `start_time`) for hour-of-day. Day-of-week from `s.date`. ✓

* **HeroInsight**: Uses `safeSessions`, all divisions protected. ✓

* **generateObservations**: Daily averages from actual dates, science detection via `subjectCategory`. ✓

* **generateActions**: Practice count uses actual date span for weekly average. ✓

***

## Implementation Order

1. **Fix Signup.jsx** (critical bug - 5 min)
2. **Create ProfileEditor component** (new feature - 15 min)
3. **Integrate ProfileEditor into Mentor.jsx settings** (5 min)
4. **Add profile access for students** (in Layout.jsx top bar - 5 min)
5. **Fix Mentor.jsx saveSchoolName to use RPC** (5 min)
6. **Create consolidated SQL migration** (triggers, RLS, RPC, index - 10 min)
7. **Build and verify** (5 min)

## Verification Steps

1. **Signup bug**: Create a mentor account, then on same browser, create a student account. Verify mentor's name is NOT changed.
2. **Profile editing**: Log in as any user, edit name, verify it persists in both `auth.users.user_metadata` and `profiles` table.
3. **Mentor edit student school**: As mentor, edit a connected student's school name, verify it succeeds.
4. **RLS security**: Attempt `supabase.from('profiles').update({ role: 2 })` as student, verify it's blocked.
5. **Chart data**: Use demo data, verify all 7 charts show correct, non-NaN values.
6. **Build**: `npm run build` passes with zero errors.

## Assumptions & Decisions

* **Email confirmation**: The fix works regardless of whether email confirmation is enabled or not, because `data.user.id` is always returned from `signUp()`.

* **Profile editor approach**: Using both `auth.updateUser()` and `profiles.update()` ensures the metadata sync trigger fires AND the profile is immediately updated.

* **RPC for mentor edit**: Using `SECURITY DEFINER` RPC is safer than adding a broad RLS UPDATE policy that could allow mentors to change student's role.

* **Trigger consolidation**: The new unified trigger uses `ON CONFLICT (id) DO UPDATE` to be idempotent, and sets both `school_id` (via school lookup) and `school_name`.

