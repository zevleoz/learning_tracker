# Mentor Dashboard — Delete Students + Student Alias (Desktop)

## Context

The mentor dashboard desktop view (in [src/pages/Mentor.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx)) is in production. Two changes are needed:

1. **Delete test/fake students** — A number of test accounts were never cleaned up and now clutter the student list. There is currently **no** way to delete a student account from the database (only `disconnectStudent()` exists, which only sets the connection status to 2). The user (admin) needs a way to actually erase test students from `auth.users` (which cascades to `profiles` and all related data), with strict failsafes so a real student is never deleted by accident.

2. **Filter/search + student alias** — Search and filter already exist on the desktop split-layout (right panel header at L827-883). The missing piece is an **alias**: each mentor wants their own private label for a student (e.g., "王小明 (隔壁班的)") so they can recognize who is who, without changing the student's real signup name. The alias is mentor-specific, so it belongs on the `teacher_student_connections` row, not on `profiles`.

Both changes are admin/mentor-scoped, desktop-only (per user's request), and must not break existing mobile views or other tabs. Existing patterns (split layout, ConfirmDialog, RPC `update_student_school` / `update_student_name`) are reused so the new code matches the codebase.

User's confirmed choices:
- Alias display: alias shown as primary name; real signup name as small gray subtitle when alias is set.
- Delete scope: admin-only (`role >= 3`).
- Delete safety: single confirm dialog with warning (no type-to-confirm).

## Approach

### Part A — Database patch (new SQL file)

New file: [supabase/schema.patch-alias-and-delete.sql](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-alias-and-delete.sql)

Idempotent patch (safe to re-run). Contents:

1. **Add `mentor_alias` column to `teacher_student_connections`** (NULL by default):
   ```sql
   alter table public.teacher_student_connections
     add column if not exists mentor_alias varchar(100);
   ```

2. **New RPC `update_student_alias(p_student_id uuid, p_alias text)`** — SECURITY DEFINER, mirrors the existing `update_student_school` pattern in [schema.patch-profile-edit-and-rls.sql](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-profile-edit-and-rls.sql) L209-244:
   - Verifies caller `is_mentor()`.
   - Verifies an accepted connection (status=1) exists between caller and student — admin's auto-connections count.
   - Updates `mentor_alias` on the matching `teacher_student_connections` row. Empty/whitespace string → set to NULL (clears alias).
   - Grant execute to `authenticated`.

3. **New RPC `delete_student(p_student_id uuid)`** — SECURITY DEFINER, admin-only:
   - Verifies caller `is_admin()` (already defined in [schema.patch-admin-connect-all.sql](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-admin-connect-all.sql) L10-18).
   - Verifies target is a student (`role = 1` in `profiles`). Refuses to delete mentors/admins.
   - Refuses self-delete (caller id ≠ target id).
   - Deletes the row from `auth.users` where `id = p_student_id`. The existing FK `profiles.id references auth.users on delete cascade` will then cascade through `profiles` → `learning_sessions`, `teacher_student_connections`, `mentor_feedback`, `student_courses`, `daily_checkins`, `user_learning_forms`, `signals` (all `on delete cascade` to profiles). Tables with `on delete set null` (e.g. `courses.created_by`) keep their rows with NULL creator.
   - Returns the deleted user id for client confirmation.
   - Grant execute to `authenticated` (the `is_admin()` check inside enforces authorization).

   Note: deleting from `auth.users` requires elevated privileges; the SECURITY DEFINER function runs as the postgres/supabase_admin role and can do this. The anon client cannot.

### Part B — Frontend changes in [src/pages/Mentor.jsx](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx)

Only the desktop split-layout (L670-1605) is modified. Mobile view (L1606+) is untouched. Existing helpers (`setConfirmState`, `toast`, `logger`, `Spinner`) are reused.

#### B1. State additions (around L121-145)

```jsx
const [editingAliasId, setEditingAliasId] = useState(null);
const [editingAliasValue, setEditingAliasValue] = useState('');
const [deleteBusyId, setDeleteBusyId] = useState(null);  // per-student delete busy
```

#### B2. Fetch mentor_alias in `loadData` (around L248-251)

Update the `teacher_student_connections` select to include `mentor_alias`:
```jsx
.select('id, student_id, status, note, mentor_alias, created_at, updated_at')
```
The existing `map[c.student_id] = c` already exposes the alias on the connection object, so no further state changes needed.

#### B3. New `saveStudentAlias(studentId, alias)` function (after `saveSchoolName` ~L636)

Mirrors `saveSchoolName` (L611-636) but calls the new `update_student_alias` RPC. Updates local `connections` state with the new alias value. Empty string clears the alias.

#### B4. New `deleteStudent(studentId)` function (after `disconnectStudent` ~L609)

Admin-only. Flow:
1. Look up student from `students` state. Bail if not found.
2. Show `setConfirmState` with:
   - `title`: '永久删除学生'
   - `message`: includes student name + warning like "此操作不可恢复，将同时删除该学生的学习记录、连接、反馈等所有数据。"
   - `confirmLabel`: '永久删除'
   - `variant`: 'danger'
3. `onConfirm` → calls `doDeleteStudent(studentId)`.
4. `doDeleteStudent`: sets `deleteBusyId`, calls `supabase.rpc('delete_student', { p_student_id: studentId })`, on success removes student from `students` state and from `connections`, clears `picked` if it was the deleted one, shows success toast, then reloads data via `loadData(user.id, isAdmin)` to refresh counts.

#### B5. Update `filteredStudents` search (L645-660)

Extend the search match to include alias OR full_name:
```jsx
const alias = connections[s.id]?.mentor_alias || '';
const matchesSearch =
  name.toLowerCase().includes(searchQuery.toLowerCase()) ||
  alias.toLowerCase().includes(searchQuery.toLowerCase());
```

#### B6. Desktop student card updates (L895-1019)

For each card in the right-panel grid:

- **Display name**: If `conn?.mentor_alias` exists, show alias as the primary name (L934) and real `full_name` as small gray subtitle. Otherwise, keep current behavior.
- **Alias edit button**: Add a small "别名" button in the action row (next to/after the existing action buttons). Clicking sets `editingAliasId = s.id` and `editingAliasValue = conn?.mentor_alias || ''`.
- **Inline alias editor**: When `editingAliasId === s.id`, render an inline editor (mirrors L1825-1854 school editor) with a text input and Save/Cancel buttons.
- **Delete button (admin-only)**: Add a small red "删除" button in the action row, visible only when `isAdmin`. Clicking triggers `deleteStudent(s.id)`. Use the existing danger style (`color: '#b91c1c'`, light red background).
- **"已设置别名" indicator**: When alias is set, show a tiny neutral chip (e.g., gray "别名" pill) near the name so the teacher can tell at a glance which students have aliases.

#### B7. Left-panel student list (L762-812)

Update the small student list items to also use alias when present:
- Replace `s.full_name || '(未命名)'` (L799) with: `conn?.mentor_alias || s.full_name || '(未命名)'`
- The subtitle line (L806) currently shows `school_name · 已连接`. If alias is set, append the real name: `${s.school_name || '-'} · ${s.full_name}` (so the teacher sees the real name on the second line when an alias overrides the first line).

#### B8. Detail panel header (L1058-1062)

When a student is picked, the detail panel header shows `picked.full_name`. Update to prefer `connections[picked.id]?.mentor_alias || picked.full_name`, and if alias exists show `picked.full_name` as a small subtitle below (matches the alias-primary display rule).

### Part C — Slight UI improvements (desktop only, no logic changes)

- **Danger button consistency**: ensure the new "删除" button uses the same visual language as `disconnectStudent` (red text on light-red background, small font, clear hover state).
- **Alias editor styling**: reuse the `.m-school-edit` / `.m-school-input` classes already defined for the school editor (L1825-1854) so the alias editor visually matches.
- **Card action row wrapping**: the current action row at L945-1015 can get cramped on narrow cards. Add `flexWrap: 'wrap'` and a small `marginTop` to the action button group so the new "别名" and "删除" buttons wrap gracefully instead of overflowing.
- **Empty state**: the existing empty state (L1023-1035) is fine — no change.
- **Filter bar header**: the right-panel header (L827-884) is already clean. No change needed; the user explicitly said don't fix what isn't broken.

No changes to mobile view, no changes to analytics/syllabus/settings tabs, no changes to the legacy dashboard code paths.

## Files to modify

| File | Change |
|---|---|
| `supabase/schema.patch-alias-and-delete.sql` | **NEW** — adds `mentor_alias` column + `update_student_alias` + `delete_student` RPCs |
| `src/pages/Mentor.jsx` | Desktop split-layout only: state, `loadData` select, alias save, delete handler, card UI, left list, detail header |

No other files touched. Mobile view (L1606+), `MentorLayout.jsx`, `ConfirmDialog.jsx`, `SharedDashboard.jsx`, and all analytics/syllabus pages are untouched.

## Reused existing patterns

- [ConfirmDialog](file:///Users/jefflau/projects/一表人才/src/components/ConfirmDialog.jsx) — already imported at L15, already used for `disconnectStudent` (L580) and `withdrawInvite` (L544).
- `update_student_school` RPC pattern — [schema.patch-profile-edit-and-rls.sql L209-244](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-profile-edit-and-rls.sql) — alias RPC mirrors this exactly.
- Inline school editor UI — [Mentor.jsx L1825-1854](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx) — alias editor mirrors this exactly.
- `is_admin()` — [schema.patch-admin-connect-all.sql L10-18](file:///Users/jefflau/projects/一表人才/supabase/schema.patch-admin-connect-all.sql) — delete RPC reuses this.
- `toast`, `logger`, `Spinner` — already imported.

## Verification

### Manual test plan (run locally with `npm run dev`)

1. **Apply SQL patch**: Run `supabase/schema.patch-alias-and-delete.sql` in the Supabase SQL Editor. Verify it returns the success message and no errors.

2. **Alias set/clear**:
   - Log in as admin, go to mentor desktop view.
   - Pick a student card, click "别名", type an alias, Save.
   - Card shows alias as primary name, real name as gray subtitle. Left-panel list also updates.
   - Search by the alias — the student should appear in results.
   - Click "别名" again, clear the input, Save — alias is removed, name reverts to real name.

3. **Delete test student**:
   - Identify one test student. Click "删除" on their card.
   - ConfirmDialog appears with the student name and warning text. Cancel does nothing.
   - Click "永久删除". Spinner shows on button. On success: card disappears from list, left-panel list updates, counts update.
   - Verify in Supabase Dashboard → Auth → Users that the user is gone. Verify `profiles`, `learning_sessions`, `teacher_student_connections` for that user are all empty (cascade worked).

4. **Safety checks**:
   - Try to delete while not admin (regular mentor account) — the "删除" button should not be visible. If you somehow craft an RPC call, the DB function should reject with "Only admins can delete students".
   - Try to delete a mentor/admin account via direct RPC call — DB function should reject with "Target is not a student".
   - Refresh page after delete — student stays gone (real DB delete, not soft delete).

5. **Regression**:
   - Mobile view still renders (resize window to ≤480px with coarse pointer, or use phone).
   - Analytics tab still works. Syllabus tab still works. Settings tab still works.
   - Existing disconnect/invite flows still work.
   - Realtime subscription still refreshes connections when a student accepts an invite.

### Automated tests

Add a new test file `__tests__/Mentor.delete-alias.test.jsx` covering:
- Alias edit button appears on admin view; clicking opens inline editor; saving calls `supabase.rpc('update_student_alias', ...)`.
- Delete button appears on admin view; clicking opens ConfirmDialog; confirming calls `supabase.rpc('delete_student', ...)`; on success the student is removed from state.
- Delete button is NOT rendered for non-admin mentors.
- Search matches alias when alias is set.

Run with `npm test` before committing. All existing tests must still pass.

### Build check

Run `npm run build` to confirm no syntax/import errors. Vite build must succeed without warnings related to the changes.

## Out of scope (explicitly not changing)

- Mobile mentor view (L1606+) — out of scope per user request.
- The `m-filter-bar` chip-based filter UI in the mobile section.
- Analytics dashboard, syllabus page, settings page.
- Legacy `ReviewDashboard` (gated by `USE_LEGACY_DASHBOARD = false`).
- Any other page (Login, Signup, Learning, ProfileEditor).
- Existing RLS policies, triggers, or indexes (the new RPCs are SECURITY DEFINER and don't need new policies).
- The `update_student_name` / `update_student_school` RPCs (kept as-is; alias is a separate field, not a name overwrite).
