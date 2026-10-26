# Release v2 · production checklist

Release candidate: branch `mentor-fixes`. It contains the student v2 redesign, the mentor/E4/supervision changes and the pre-release review fixes.
- Status: 1,103 tests pass, the build is clean, and the build contains no secrets.
- Production today runs GitHub `main` at `51317140`. The release is a fast-forward of 61 commits.

## 1. Database: run first (safe with the current live app)

Run these in the Supabase SQL Editor, in this order. Each is idempotent and safe to re-run. All three are compatible with the code that is live now: admin auto-connect (role ≥ 3) and students accepting invites keep working.

1. `supabase/schema.patch-push-notifications.sql`. **Re-run the latest version**, because the one you ran earlier predates the email column and the permission fixes.
2. `supabase/schema.patch-mentor-connections.sql`. Required for mentor 断开 and 重新邀请. It also blocks non-admin mentors from creating connections without the student's consent.
3. `supabase/schema.patch-supervision.sql`. Creates the AI supervision drafts table.

Check afterwards:

```sql
select to_regprocedure('public.register_push_subscription(text,text,text,text)') is not null as push_fn,
       to_regprocedure('public.mentor_disconnect(uuid)') is not null as disconnect_fn,
       to_regprocedure('public.mentor_reinvite(uuid,text)') is not null as reinvite_fn,
       to_regclass('public.supervision_drafts') is not null as drafts_table,
       exists (select 1 from information_schema.columns
               where table_name = 'push_deliveries' and column_name = 'channel') as email_channel;
```

All five should be `true`.

## 2. Vercel: Production environment variables

| Variable | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | notifications, test button, supervision |
| `NOTIFY_SECRET` | the scheduled jobs and the invite webhook |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VITE_VAPID_PUBLIC_KEY` (same public key) | push notifications. Use the same keys as Preview, so devices that subscribed during testing keep working. |
| `LLM_API_KEY` (+ `LLM_BASE_URL`, `LLM_MODEL` if not default) | AI supervision drafts |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_URL` | optional: the day-3 email fallback |

Missing variables never break pages; the affected feature just stays off.

## 3. Deploy

Push `mentor-fixes` to GitHub `main`. Vercel builds and deploys production automatically. Open students pick up the new version on their next open, or through the 更新 prompt.

## 4. Smoke test right after deploy

- Student account: 今天, 记一笔 (save one record and delete it), 洞察, 我的, and 我的 › 提醒 › 发送测试通知 from the iPhone Home Screen app.
- Mentor account: /mentor student list, open a student, 数据分析, and E4 待办 plus one report.
- If anything is wrong, use Vercel → Deployments → previous production deployment → **Instant Rollback**. The SQL from step 1 is compatible with the old code, so nothing needs undoing in the database.

## 5. Turn on the schedules (when ready)

Use Supabase pg_cron + pg_net. Commented examples are at the end of the push and supervision SQL patches.
- Every 15 minutes: `POST /api/notify` with `{"type":"tick"}` and the header `x-notify-secret`.
- Every 15 minutes: `POST /api/supervision` with `{"type":"run"}` and the same header.
- Database webhook on `teacher_student_connections` INSERT → `/api/notify`, same header (instant invite push).

Until these exist: no reminders, no AI drafts and no instant invite push. Everything else works.

## Known and accepted for this release

- The mentor diagnostics keep the existing 60/90 min-per-day thresholds (unchanged from production).
- Low-risk follow-ups:
  - a rate limit on mentor re-invite pushes
  - a weekly supervision draft is skipped if the Monday run fails
  - `handled_by` on drafts isn't forced to the current mentor
  - mentor accounts would also receive the first-month daily reminder if they subscribed to push
