# 导师台 + E4 · Audit and implementation plan

Audit page (open in a browser): `docs/mentor-e4-audit/audit.html`
Published copy: https://claude.ai/artifact/GJj2xd3aR3XpXAM2uavUFe
Screen layouts (the visual spec for WS-A/D/E): `docs/mentor-e4-audit/designs.html`, published at https://claude.ai/artifact/B6Vbg2WmHMWfrd8gGaWNL7
Context brief: `docs/MENTOR-SIDE-CONTEXT.md`. Earlier plan `PLAN-e4-todos-mentor-stats.md` is already applied (`src/lib/e4Todos.js` exists, `mentor-overview` is gone), so it is not repeated here.

Scope: the mentor tracker (`/mentor`) and E4 (`/e4*`). The student side is out of scope except where a shared rule is involved. This is a correction pass plus one new feature (AI 监督流程), not a redesign.

## Rules for every workstream

1. **No push, no PR.** Commit only to your own local branch. Pushing `main` deploys production.
2. **Edit only the files your workstream owns.** If you need a change elsewhere, list it under "Follow-ups" in your report.
3. **No new npm dependencies.**
4. **主观评价 / 客观评价 rules stay as they are** (`src/lib/sessionRules.js`, `src/lib/rating.js`). Read them; do not rename or relabel.
5. **No minutes goal, no rest-day quota.** Don't add new minute thresholds; WS-A asks before removing existing mentor-side ones (see open questions).
6. **No new student pushes or emails** except the re-invite push, and only if the user approves it (open question 2).
7. **Database:** never run anything against Supabase. Schema changes go into a new idempotent `supabase/schema.patch-*.sql`. Tests use the mocks in `src/__mocks__`.
8. **System fonts, one crest red `#A3202A`.** No outlined cards everywhere, pill clutter, emoji, glows or hover-lift. Copy is short plain Chinese.
9. **Quality bar:** `npx jest -w 3` and `npm run build` pass; new logic gets tests. Check `/mentor` and `/e4` in the harness before and after any CSS change.

## Local harness (already set up, git-ignored)

`npx vite --config vite.harness.config.js` → http://127.0.0.1:5199

- `/mentor` and `/e4*` now load a fake **admin** mentor (陈老师) with 9 students covering every case: daily filler, first-month filled yesterday, first-month missed yesterday, 4 days missing, new signup who never filled, 邀请中, 已拒绝, 未邀请. Add `?role=2` to see a normal mentor (connected students only).
- E4 has 5 students and 5 reports; the prep and first reports are built from the real Leo/Catherine protocol fixtures, so the builders render.
- Files: `.harness/mentorData.js` (new), `.harness/supabase.js`, `.harness/useAuth.js`. `.claude/launch.json` has a `harness` entry for the in-app browser.
- Any workstream may add fake rows to `.harness/mentorData.js`; note it in the report.

## Findings → workstreams

| ID | Severity | Finding | WS |
|---|---|---|---|
| H1 | High | Analytics count 客观 only from numeric `score`. v2 records save a letter `grade_label` with `score = null`, so「练习反馈密度严重不足」fires for students who did grade their practice; practice average, per-subject score rule and the E4 progress report's 客观 stats read as empty. N/A is counted as a 客观评价 in the practice card. | A |
| H2 | High | `tsc_insert_teacher` doesn't restrict `status`. Any mentor account can insert `status = 1` through the API and read a student's records without the student accepting. Admin auto-connect relies on this. | C (SQL), D (UI) |
| H3 | High (verify) | No teacher UPDATE policy in `001-production-setup.sql`, so 断开连接 `update({status:2})` likely matches 0 rows without an error: the UI says 已断开, the reload shows 已连接. Re-invite after 已拒绝/断开 inserts a duplicate `(teacher_id, student_id)` → 23505 → toast「该学生已经被邀请过了」, so re-inviting never works. | C (SQL), D (UI) |
| M1 | Medium | 学生管理 defaults to every student profile (up to 500, other mentors' students included), sorted by signup date. **Not changed** (user keeps the current interface); the 今日反馈 panel covers who needs attention. | — |
| M2 | Medium | The inactivity rule skips accounts younger than 7 days with no records. Those are the first-month students the new 监督流程 targets. | C |
| M3 | Medium | 教育诊断 shows「学习行为健康」for a student with 3/7 active days and nothing for 3 days; 日均 is averaged over active days only. | A |
| M4 | Medium | Student side panel shows all-time totals and a red hint box. **Not changed** (user keeps the current interface). | — |
| M5 | Medium | E4 待办: a meeting whose date has passed with no report sits at the bottom in 待安排, mixed with never-scheduled students. Progress meetings that passed get no 写报告 prompt (only `first` does). | E |
| M6 | Medium | E4 has no ownership view: every mentor's 待办 and 学生中心 show every E4 student. `advisor_id` exists but is unused for filtering. | E (after decision) |
| M7 | Medium | E4 student detail doesn't show the next meeting or the next step; all three 生成 buttons look equal after prep and first are final. No link from 追踪学生 to that student's tracker data. | E |
| L1 | Low | Phone 学生管理 cards are tall. **Not changed.** | — |
| L2 | Low | Admin's permanent 删除 sits on every card next to 备注名. **Not changed.** | — |
| L3 | Low | Analytics selected states use indigo/violet. **Not changed** (no visual change to the tracker). | — |
| L4 | Low | 4-week 周历 cells wrap numbers at ~1000px window width (「3h3 / 3」); E4 student table and builder toolbar clip at the same width. | A (周历), E (E4) |
| L5 | Low | 「已触达 N 次」 on E4 待办 is unclear. | E |
| L6 | Low | Admin rows with an old 邀请中/已拒绝 row are skipped by auto-connect, so admin sees them listed but can't read their data (shows false 未填写). | C (SQL trigger) |
| L7 | Housekeeping | `HANDOFF.md` (tracked, on GitHub `main`) still lists the plaintext admin and test passwords; its appendix says rotation is pending. Rotate, then remove them from the file. | user |

---

## WS-A · Analytics correctness (Sonnet)

**Owns:** `src/lib/objective.js` (new), `__tests__/objective.test.js` (new), `src/components/DeepDivePanels.jsx`, `src/components/DimensionStrip.jsx`, `src/components/DayDetailPanel.jsx`, `src/components/WeekGrid.jsx`, `src/lib/e4ProgressData.js`, `__tests__/e4ProgressData.test.js`, mentor analytics CSS in `src/index.css` (mentor sections only).

**Build:**
- `objective.js`: `objectiveOf(row)` returns `{ kind: 'grade', label, value } | { kind: 'na' } | { kind: 'score', value } | null`. Letter grades map to a 0–100 value through the 13-step scale already in `sessionRules.js` (`OBJECTIVE_STEPS`; `studentStats.js` has a copy, reuse rather than add a third); old rows with numeric `score` keep working. `N/A` is `kind: 'na'` and is excluded from numerators **and** denominators.
- Replace every `eval_type === 2 && score != null` test in the owned files with `objectiveOf`. Rule 6 (练习反馈密度) counts graded + numeric; N/A practices leave the denominator. Rule 4 and the practice average use `value`. The practice card's 「近 5 次客观评价」 skips N/A or labels it 不适用 without counting it as 客观评价.
- `e4ProgressData`: count 主观 from `self_rating` on every row (it's always saved) and 客观 through `objectiveOf`, not split by `eval_type`.
- Diagnosis: add a participation rule before「学习行为健康」 (active days in the range, longest gap). Never show 健康 while the student has ≥3 consecutive empty days in range. Rename 日均 to 「有记录日均」 wherever it's averaged over active days.
- L4: 周历 cells don't wrap numbers at 1000px (smaller type or hide the subject lines under a width).

**Done when:** in the harness, 林小满 · 近4周 shows no「练习反馈密度」 alert, the practice card no longer counts N/A, 陈思远 · 本周 is not 「健康」; tests cover letter, N/A, numeric and mixed rows.

## WS-C · Supervision backend + connection SQL (Opus)

**Owns:** `src/lib/supervision.js` (new, pure rules shared by server and client), `api-lib/supervision.mjs` (new: data access + prompt + LLM call), `api/supervision/index.js` (new), `supabase/schema.patch-supervision.sql` (new), `supabase/schema.patch-mentor-connections.sql` (new), `scripts/supervision-dry-run.mjs` (new), `__tests__/supervision*.test.js` (new), `vite.harness.config.js` and `vite.config.js` (dev middleware only).

### Rules (`src/lib/supervision.js`, pure, Asia/Shanghai dates)
- `phaseOf(signupDate, today)`: `'daily'` while `today - signup < 30` days (day 0 … 29), else `'weekly'`. Anchor is `profiles.created_at` (user decision).
- Daily, for D = yesterday: **filled** = at least one non-deleted `learning_sessions` row with `session_date = D`. A 待补填 record counts as filled. Filled → one praise draft. Not filled → 「昨天未填写」 list.
- Weekly, generated Monday for the previous Mon–Sun: every weekly-phase student with ≥1 record that week gets one draft (praise + 可能存在的问题). Zero records → no draft; they show in the list below.
- 「连续 3 天以上没填写」, weekly-phase students: no record on D-1, D-2 and D-3 (counted back from today; includes students with no records at all). First-month students are already covered daily and don't appear here twice.
- Students in scope: `status = 1` connections of the viewer (admin: all). Lists are computed **live** in the browser from `learning_sessions`, so a student who fills in late drops off the list without waiting for the job.

### Table and policies (`schema.patch-supervision.sql`)
```sql
create table if not exists public.supervision_drafts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  kind         varchar(8) not null check (kind in ('daily', 'weekly')),
  period_start date not null,
  period_end   date not null,
  body         text not null,                 -- AI 原稿
  edited_body  text,                          -- 导师改过的版本
  evidence     jsonb not null default '[]'::jsonb, -- 引用的记录 id
  model        varchar(64),
  status       varchar(8) not null default 'draft' check (status in ('draft', 'sent', 'skipped')),
  handled_by   uuid references public.profiles(id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, kind, period_start)
);
create index if not exists supervision_drafts_period on public.supervision_drafts (period_start desc);

drop trigger if exists supervision_drafts_updated on public.supervision_drafts;
create trigger supervision_drafts_updated before update on public.supervision_drafts
  for each row execute function public.set_updated_at();

alter table public.supervision_drafts enable row level security;
drop policy if exists sd_select on public.supervision_drafts;
create policy sd_select on public.supervision_drafts for select
  using (public.is_connected_teacher_of(student_id));
drop policy if exists sd_update on public.supervision_drafts;
create policy sd_update on public.supervision_drafts for update
  using (public.is_connected_teacher_of(student_id))
  with check (public.is_connected_teacher_of(student_id));
-- 客户端只能改这几列；插入和重新生成只走服务端（service role）
revoke update on public.supervision_drafts from authenticated;
grant update (edited_body, status, handled_by, handled_at) on public.supervision_drafts to authenticated;
-- 学生零访问：没有学生相关的 policy。
```
Plus a commented-out `cron.schedule('yb-supervision-tick', '*/15 * * * *', …)` block in the same shape as the push patch, posting `{"type":"run"}` to `/api/supervision` with `x-notify-secret`.

### Connection fixes (`schema.patch-mentor-connections.sql`)
Start the file with the read-only check the user runs first:
```sql
select policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'teacher_student_connections';
```
Then:
```sql
-- H2：普通导师只能发邀请（status 0）；只有 admin 可以直接建立连接
drop policy if exists tsc_insert_teacher on public.teacher_student_connections;
create policy tsc_insert_teacher on public.teacher_student_connections for insert to public
with check (
  teacher_id = auth.uid() and public.is_mentor() and student_id <> auth.uid()
  and (status = 0 or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role >= 3))
);

-- H3：断开 / 重新邀请走 RPC，没改到行时报错而不是静默成功
create or replace function public.mentor_disconnect(p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mentor() then raise exception '仅导师可操作'; end if;
  update teacher_student_connections set status = 2, updated_at = now()
   where teacher_id = auth.uid() and student_id = p_student and status = 1;
  if not found then raise exception '没有找到已连接的这位学生'; end if;
end $$;

create or replace function public.mentor_reinvite(p_student uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mentor() then raise exception '仅导师可操作'; end if;
  update teacher_student_connections
     set status = 0, note = left(coalesce(p_note, ''), 200), updated_at = now()
   where teacher_id = auth.uid() and student_id = p_student and status = 2;
  if not found then raise exception '这位学生当前不能重新邀请'; end if;
end $$;

grant execute on function public.mentor_disconnect(uuid) to authenticated;
grant execute on function public.mentor_reinvite(uuid, text) to authenticated;
```
L6 (optional, same file): an `after insert on profiles` trigger that connects new students to every admin, so auto-connect stops depending on an admin opening `/mentor`.

### Endpoint (`api/supervision/index.js`)
- `POST {type:'run'}` with `x-notify-secret` = `NOTIFY_SECRET`: finds missing drafts (daily for yesterday; weekly on Mondays) and generates **at most 15 per call**, stopping at ~45s. The unique key makes it idempotent, so the 15-minute cron picks up late fillers through the day. Skip 23:00–06:00 Shanghai.
- `POST {type:'regenerate', draft_id}` with a mentor bearer token: `requireMentor`, then check `is_connected_teacher_of` for that student, regenerate, overwrite `body`, clear `edited_body`.
- `POST {type:'preview', students, sessions, today}` **dev only** (rejected unless `NODE_ENV !== 'production'` and the request comes from the local dev middleware): runs the same generator on posted data and returns drafts without touching any database. Used by the harness.
- LLM: `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` (local `.env.local` points at DashScope `qwen3.8-flash`). Same OpenAI-compatible call and JSON parsing as `api/llm/cell-note.js`.

### Prompt contract
- Input per student: **no name** (the UI adds it), records for the period (course, 学/复/练, form, duration, 主观 label from `rating.js`, 客观 grade or 待补填, notes), plus `studentStats.js` outputs (week-over-week, streak, 待补填 count, calibration).
- Output JSON `{ text, evidence: [session ids] }`.
- Daily: one sentence, ≤ 60 characters, praises something specific that is in the records (a subject, a 复习 after a 练习, a 客观 grade, a note). No generic praise, no advice.
- Weekly: 120–200 characters, 「这周做得好」 then 「可能要注意」. A problem is mentioned only when the records show it (自评 above 实测, 待补填 piling up, one subject untouched, gaps). If there is none, say nothing.
- Never: minutes targets, 「应该学 X 分钟」, comparisons with other students, rest-day judgement, emoji.

### Local testing (this workstream delivers all three)
1. `npx jest -w 3 __tests__/supervision` — phase boundary (day 29 vs 30), yesterday filled/unfilled, late filler, Monday window, 3-day rule, Shanghai midnight.
2. `node scripts/supervision-dry-run.mjs` — builds drafts for the harness fixture students with the real model from `.env.local` and prints them. Nothing is written. `--live --limit 5` reads production **read-only** (service key from `scripts/.env.scripts`) and prints drafts for real students; run it only with the user's OK, because it sends real records to DashScope.
3. Harness: `vite.harness.config.js` gets a middleware for `/api/supervision` that calls the generator with the `.env.local` key. 「重新生成」 in the harness returns real model output on fake data.

**Done when:** tests pass, the dry run prints sensible drafts for the 4 relevant fixture students, SQL files are idempotent (safe to run twice), no student-facing code changed.

## WS-D · Mentor tracker: fill status, 今日反馈, full records, invite fixes (Opus; large file)

The tracker keeps its look (no redesign, no new tab or sidebar change). Visual spec: `designs.html#tracker` and `#sheet` (screenshots of the real page with the changes added).

**Owns:** `src/pages/Mentor.jsx`, `src/components/mentor/TodayFeedback.jsx` (new), `src/components/mentor/StudentTable.jsx` (new), `src/components/mentor/FillStrip.jsx` (new), `src/components/mentor/SheetRecordRow.jsx` (new), `src/components/DayDetailPanel.jsx` (待补填 line only; coordinate with WS-A, which also edits it — WS-A goes first), mentor sections of `src/index.css`, `__tests__/Mentor*.test.jsx` (keep `Mentor.delete-alias.test.jsx` passing).

**Build:**
- Remove `.mentor-page-header` (title + subtitle) from all four desktop views: 学生管理, 数据分析, 课表, 系统设置. Keep spacing so content starts at the top.
- Load the last 7 days of `session_date` for the viewer's connected students once (already done in `loadClassStats`; keep its rows instead of discarding them) and derive per-student filled days.
- **Keep the advisor grouping** from `groupByConsultant` (parentheses in `mentor_alias`) and its chips. Inside each group, first-month students (signup < 30 days, `src/lib/supervision.js` `phaseOf`) sort first, then the rest in the current order. First-month card row: 「昨天填了」 green / 「昨天没填」 red, 「今天还没填」 grey or 「今天已填」 green, and the 7-day strip. A red 「第 N 天」 tag next to the name (day 1 = signup day).
- Other connected students: 「N/7 近 7 天」 and the 7-day strip (Mon→Sun of the last 7 days ending today; filled square = at least one record; title attribute gives the date). The 「N 天未填写」 text stays only when ≥ 3 days and never on first-month cards (their 昨天 line covers it).
- **List view (default)** in `src/components/mentor/StudentTable.jsx` (new): one ~42px row per student inside each advisor group, fixed columns that align across groups — 学生 · 学校 · 阶段 (「第 N 天」 / 每周) · 近 7 天 (strip, today dashed, N/7) · 需关注 (昨天填了/没填 for first month; 「N 天没填」 ≥ 3 for others) · 最后记录 (date + 「N 天前」) · 待补填 · 连接 · hover actions (断开 / 改备注 / ··· with the existing handlers). Group header shows 「N 人 · 第一个月 n · 昨天未填 n · 3 天以上没填 n」. Sort inside a group: connected first, first-month first, then longest gap. 「列表 / 卡片」 switch (remembered in localStorage); 卡片 is today's cards plus the fill row.
- One-row filter bar: search, 学校, 连接, advisor chips, view switch.
- Keyboard: `J`/`K` move selection (also inside the side panel), `Enter` opens, `/` focuses search, `T` toggles 今日反馈; in 今日反馈 `C` copies and `E` marks sent. Ignore keys while typing in inputs. Hints line at the bottom of the page.
- 今日反馈 folded = a strip of counts; open = tabs 待发 / 新生昨天没填 / 3 天以上没填 / 已发.
- Names are links: on cards, in 今日反馈 drafts and in the 未填 lists (drafts and lists also show the advisor, e.g. 「Angela · 第 21 天」). All open the existing side panel for that student.
- `TodayFeedback` above `.mentor-toolbar`: folded one-liner with counts; open shows drafts (复制 / 已发 / 重新生成, 「依据」 line, click text to edit → `edited_body`) and the 未填 lists with 「复制名单」. Hidden when empty.
- Side panel: tiles become 近 7 天有记录 / 待补填 / 最后记录. Remove the red hint box. The list shows records grouped by date with every field the student entered: start–end time, course, 学/复/练, form, chapter · unit, notes, duration, 主观 label, 客观 grade / 待补填 / 不适用. Keep 前往数据分析 / 前往课表.
- Invite / disconnect / re-invite call the WS-C functions and show their error text; a successful re-invite triggers the invite push via WS-C's mentor endpoint.
- Phone: the same card rows and side panel content; no other phone layout change.

**Done when:** in the harness (`?role=2` and admin, 1280px and 375px) the page matches the screenshots, every field a student can enter appears in the side panel, and 再次邀请 on 吴雨桐 calls the re-invite function.

## WS-E · E4 polish (Sonnet)

**Owns:** `src/lib/e4Todos.js`, `__tests__/e4Todos.test.js`, `src/pages/e4/E4TodosPage.jsx`, `src/pages/e4/E4StudentListPage.jsx`, `src/pages/e4/E4StudentDetailPage.jsx`, `src/lib/e4Store.js` (read helpers only), E4 sections of `src/index.css`.

**Build:**
- M5: a top group **待写报告** for students whose meeting date is today or earlier and who have no `first`/`progress` report created on or after that date (first or progress alike). Then 今天 / 未来 7 天 / 之后 / 待安排. Each card's main action matches its group.
- M6: 「我的 / 全部」 toggle on 待办 and 学生中心, filtering by `advisor_id`; the default depends on the user's answer (open question 1).
- M7: detail page header shows 「下次会议」 and one primary 「下一步」 button derived from what exists (no prep → 生成会前准备; prep, no first → 生成首次报告; first done → 生成过程报告). The other 生成 buttons become secondary. 追踪学生 links to `/mentor` (opening that student's existing side panel needs a small `?student=<id>` handler in `Mentor.jsx`; list it as a follow-up for WS-D rather than editing `Mentor.jsx`).
- L5: 「已触达 N 次」 → 「已出报告 N 份」.
- L4: the student table and builder toolbar don't clip at 1000px.

**Done when:** in the harness, 陈思远 appears under 待写报告, Leo's detail shows the 过程报告 as the next step, tests cover grouping with first/progress/none.

---

## Order of work

1. **Now, in parallel:** WS-A, WS-C, WS-E (no shared files).
2. **WS-D** starts when WS-C's table shape and endpoint contract are fixed (day 1 of WS-C). It can build against fake rows in `.harness/mentorData.js`.
3. **Integration on one local branch,** then the harness check: admin and `?role=2`, 375px and 1440px, `/mentor` and `/e4`, plus the student side unchanged.
4. **User runs SQL** in the Supabase SQL editor: the read-only policy check first, then `schema.patch-mentor-connections.sql`, then `schema.patch-supervision.sql`. Add `SUPABASE_SERVICE_ROLE_KEY`, `NOTIFY_SECRET` and the `LLM_*` variables to the preview environment if they aren't there.
5. **Preview branch** (non-main, with the user's OK) for a real-data run; then schedule the cron and merge to `main`.

## Decisions (user, 2026-10-25)

1. E4 待办 and 学生中心 default to **我的** (`advisor_id` = me), with a switch to 全部.
2. Re-inviting a student who declined **sends the invite push again** (same push as a first invite). WS-D calls `POST /api/notify {"type":"invite"}` path after `mentor_reinvite` succeeds; WS-C adds a mentor-authenticated way to trigger it (bearer token + `is_mentor`, student must have a status-0 row from this mentor), since the client can't hold `NOTIFY_SECRET`.
3. **Keep** the mentor-side minute thresholds (「日均 < 60 分钟」, 30% 自主 警戒线). WS-A doesn't remove them.
4. There are no planned rest days. Any day without a record counts as 未填写.
5. Sending records without names to DashScope is approved.
6. Before any code changes, the new screens are laid out in HTML (`docs/mentor-e4-audit/designs.html`) and must stay close to today's look.
7. The 一表人才 tracker redesign is dropped: the interface keeps its look. AI drafts and the 未填写 summaries go in one panel at the top of 学生管理. The E4 layout changes are kept.
8. (2026-10-26) Remove the page header on all tracker pages; students stay grouped by advisor (备注名 parentheses); first-month students sort first inside their group with daily 昨天/今天 status; later students show N/7 and a 7-day strip; names open the side panel; the side panel shows every field the student fills in. No separate page for now.
9. (2026-10-26) 学生管理 gets a denser, tool-style list view as the default (advisor groups kept, aligned columns, hover actions, keyboard shortcuts); cards remain as a switch.
10. (2026-10-26) Wording: students in their first 30 days are 「新生」 (阶段 「新生 · 第 N 天」); lists say 「新生昨天没填」 and 「3 天以上没填」; cells say 「昨天填了 / 昨天没填」 and 「N 天没填」.
11. (2026-10-26) The AI prompt is done and tuned against the real model: `api-lib/supervision-prompt.mjs` (prompt, lint, one automatic rewrite), `scripts/supervision-dry-run.mjs` + `scripts/fixtures/supervision-sample.json`, tests in `__tests__/supervisionPrompt.test.js`. Weekly problems are detected in code and passed in as 「要提的问题」; the model never decides on its own that there is a problem. WS-C builds the endpoint and job on top of this module and must not loosen its rules without re-running the dry run.
