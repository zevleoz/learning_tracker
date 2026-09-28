# E4 Phase 1 (首次学习力分析报告) — Implementation Plan

## Task 1: Database schema and RLS for E4
- **Status**: pending
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Add idempotent migration `supabase/schema.patch-e4.sql` creating `public.e4_students` and `public.e4_reports` per spec F27, plus `profiles.default_workspace varchar not null default 'e4'`.
  - Enable RLS: role ≥ 2 full select/insert/update on both tables; role 1 (students) no access; delete policies omitted (no delete UI).
  - Restrict `default_workspace` self-update to own profile consistent with existing profile-update conventions (self policy or RPC if needed).
  - Indexes on `e4_reports(e4_student_id)`, `e4_students(advisor_id)`, Y4 link columns.
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `rule` TR-1.1: Migration is idempotent (re-run succeeds). Evidence: run twice, no error.
  - `rule` TR-1.2: An authenticated student token selects zero rows from both tables and cannot insert; a mentor token can insert/select. Evidence: SQL verification script output.
  - `rule` TR-1.3: Existing profiles default to workspace `e4`; a user can update only their own `default_workspace`. Evidence: SQL update attempts as two identities.

## Task 2: Y4 secure proxy (Vercel function + local dev middleware)
- **Status**: pending
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Add `api/y4/[...path].js` Node serverless function forwarding GET requests to `https://report.p4learning-ark.app/api/v1/*`, injecting `Authorization: Bearer ${process.env.Y4_API_KEY}`, with `maxDuration` ≥ 60 and JSON/stream passthrough; map upstream status codes and `{ok:false}` errors transparently.
  - Add a Vite dev-server plugin/middleware in `vite.config.js` exposing the same `/api/y4/*` surface locally, using Node https with no domain SNI + `Host: report.p4learning-ark.app` header (local-network SNI workaround); enabled in dev only.
  - Add `Y4_API_KEY=` / `Y4_API_BASE=` placeholders to `.env.example`; put the real key only in git-ignored `.env.local`; verify `.gitignore` covers it.
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-2.1: `git grep` of the real key over tracked files returns nothing; built client bundle contains no `report.p4learning-ark.app` host or key. Evidence: grep + bundle grep.
  - `rule` TR-2.2: Through `npm run dev`, `GET /api/y4/students` returns the live student list; `/api/y4/reports/25/e4-protocol` returns Leo markdown; an invalid-key run returns a clear error. Evidence: curl output.
  - `rule` TR-2.3: Upstream 404/429/503 are passed through with identifiable status and message. Evidence: forced-error request output.

## Task 3: Y4 client library and fixtures
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Add `src/lib/y4api.js`: `listStudents(query)`, `listReports(y4StudentId)`, `fetchProtocol(y4ReportId)` (long timeout, abort support), optional `fetchY4Markdown(id)`; all call same-origin `/api/y4/*`; normalize errors to typed messages in Chinese.
  - Save the two fetched protocol response bodies as `__tests__/fixtures/e4_protocol_25_leo.md` and `e4_protocol_27_catherine.md` (content only, no keys/headers).
- **Acceptance Criteria Addressed**: AC-4, AC-5
- **Test Requirements**:
  - `rule` TR-3.1: Client functions hit only same-origin paths and abort an in-flight protocol fetch on cancel. Evidence: code inspection + small fetch-mock/jest test.
  - `rule` TR-3.2: Fixtures exist, parse as UTF-8 markdown, and contain no secret material. Evidence: file listing + grep.

## Task 4: E4 protocol parser + report template mapping
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - `src/lib/e4ProtocolParser.js`: parse META, E1–E4 blocks (questions with VERDICT/LIST/topic/EVALs/REFs/judgment; E2 single block), OTHER_VARIABLES (EVAL/ORDER/NORM), 核心问题 / 可能失真 / 跟进线索, OVERVIEW (真实优势/名单归属), Y4_INTERPRETATION raw, trailing 名单归属. Tolerate missing sections, blank values, unknown tags; never throw on malformed input.
  - `src/lib/e4ReportTemplate.js`: fixed canonical template — section titles (CN+EN), 30 checklist rows with ids/labels/aliases, supplement rows, per-section narrative box definitions, default VERDICT→综合判断 mapping (健康/中性→暂未发现; 关注/需支持/需介入→可能存在), Y4 clue drafting from evals+judgment, section-07 auto-grouping of confirmed rows by dimension (solution rows and next-review fields are deliberately not seeded).
  - `buildReportDraft(protocol)` returns the full prefilled form model.
  - Jest tests in `__tests__/e4ProtocolParser.test.js` over both fixtures.
- **Acceptance Criteria Addressed**: AC-5, AC-6
- **Test Requirements**:
  - `rule` TR-4.1: Leo fixture parses to 4 dimensions, E1=8 / E2 block / E3=11 / E4=8 questions, all verdicts/evals/refs/judgments captured; Catherine fixture likewise. Evidence: Jest.
  - `rule` TR-4.2: All 30 template rows resolve for Leo (8+4+3+11+7+5); 确定性需求 lands in additional clues; every mapped main-row clue cell for Leo is non-empty and contains no raw bracket tokens. Evidence: Jest snapshot/assertions.
  - `rule` TR-4.3: Parser returns a safe empty structure for truncated/empty markdown instead of throwing. Evidence: Jest.

## Task 5: E4 shell, routes, landing preference, workspace switch
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Add `/e4` protected route subtree (minRole 2) with an E4 sidebar layout matching mentor desktop conventions (brand line "E4 学习力导师平台", nav: 学生 / 设置 placeholder, footer user block + sign-out reused).
  - Root redirect for role ≥ 2 honors `profiles.default_workspace` (`e4` default → `/e4`, `tracker` → `/mentor`); student redirect unchanged.
  - Add quick-switch control ("前往一表人才" / "前往 E4") to both `MentorLayout` sidebar and E4 layout; add workspace selector to existing 系统设置; persist via Supabase update.
- **Acceptance Criteria Addressed**: AC-2, AC-13
- **Test Requirements**:
  - `rule` TR-5.1: Role ≥ 2 `/` redirect matches stored preference in both directions; student `/` behavior unchanged. Evidence: manual route verification.
  - `rule` TR-5.2: Switch controls navigate both ways without logout; setting persists across reload. Evidence: manual verification.
  - `rubric` TR-5.3: Non-disruption of 一表人才; scale 0-3; 0 = existing layout broken, 2 = intact with neutral additive switch, 3 = switch feels native; threshold ≥ 2; evidence: /mentor + student page walkthrough screenshots.

## Task 6: E4 student list, detail, create/edit, Y4 linking
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 3, Task 5
- **Description**:
  - E4 student list view (name, grade, advisor, Y4 link status, report count) and create/edit modal (viewport-centered per conventions): display_name required; gender/grade/school/notes optional; advisor defaults to creator; optional tracker-student picker from existing `profiles` students.
  - Y4 link picker: search Y4 students via proxy (client-side name filter), then pick one of their reports; show report date; store y4 ids on the E4 student.
  - Student detail dashboard: fields, link status with change action, reports list (status/dates), "生成首次报告" entry.
- **Acceptance Criteria Addressed**: AC-7, AC-12
- **Test Requirements**:
  - `rule` TR-6.1: Creating an E4 student for Leo and linking Y4 student 25 / report 25 persists correct rows and appears in list/detail. Evidence: Supabase rows + UI.
  - `rule` TR-6.2: Y4 picker lists live students/reports through the proxy and handles a student with zero reports gracefully. Evidence: manual verification (use id 34/26).
  - `rubric` TR-6.3: Linking clarity; scale 0-3; anchors 0 = Y4 identity ambiguous, 2 = clear list+dates with confirm step, 3 = confident one-pass manual matching; threshold ≥ 2; evidence: guided use.

## Task 7: First-report builder stepper and persistence
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 4, Task 6
- **Description**:
  - Stepper: (1) confirm Y4 link then fetch protocol with cancelable 10–30s loading state; store snapshot on a new `e4_reports` row immediately; (2) meeting date / report date (default today) / 报告性质 default + minutes free-text textarea; (3) review matrix: per-row editable Y4 clue, meeting-verify text, 综合判断 dropdown; supplement rows marked meeting-only; minutes panel side-by-side/toggle; section narrative boxes; (4) section-07 editor per D2: two quote excerpt fields with minutes-assisted copy-in; auto-grouped confirmed-issues table across the four E dimensions (editable/deletable); 问题解决方案 starts empty with friendly add/remove two-column rows; 时间 + 重点验证 start empty with prompts; the whole page editable; (5) entry to print preview.
  - Debounced autosave of `form_data` + inputs; reopen resumes from snapshot with no refetch; explicit save feedback and 标记最终版 action.
  - Validation: block print preview / 最终版 when meeting date, report date, or section-07 时间/重点验证 are missing; empty cells otherwise allowed in drafts and render as "—".
- **Acceptance Criteria Addressed**: AC-7, AC-9, AC-12
- **Test Requirements**:
  - `rule` TR-7.1: Leo end-to-end draft saves; closing and reopening restores all edits without calling the protocol endpoint. Evidence: network panel shows no e4-protocol request + row data equal.
  - `rule` TR-7.2: Every 综合判断 value in persisted/printed model is one of the four exact states; unknown verdict never produces a fifth label. Evidence: Jest over buildReportDraft + saved JSON.
  - `rubric` TR-7.3: Review workflow usability; scale 0-3; anchors per AC-12; threshold ≥ 2; evidence: timed mentor walkthrough using real minutes text.

## Task 8: First-report print view and PDF export
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 7
- **Description**:
  - Print route `/e4/reports/:id/print` rendering exactly the sample structure: cover, 02 如何阅读 (static copy), 03–06 Emotion/Energy/Engine/Engagement with 4-column tables, supplement tables, narrative boxes, 07 综合判断 (quotes, confirmed-issues, growth directions, next review); A4 `@page` CSS, section page breaks, print-only stylesheet, no app chrome.
  - "下载 PDF" button calls window.print; on-screen header hidden in print; CJK system font stack; neutral black/gray, no emojis, text-only judgment states.
  - Empty optional cells render as "—"; no parser tokens/undefined anywhere.
- **Acceptance Criteria Addressed**: AC-8, AC-9, AC-11
- **Test Requirements**:
  - `rule` TR-8.1: Print HTML contains all sample sections and exact row labels in order; print preview shows no sidebar/button chrome and section breaks are sane. Evidence: print-preview check vs docx.
  - `rule` TR-8.2: Automated assertion over rendered print HTML: no `undefined`, `[EVAL]`, `[VERDICT]`, `[REF]` strings; all judgment labels from the allowed set. Evidence: Jest/RTL test.
  - `rubric` TR-8.3: PDF fidelity; scale 0-3; anchors per AC-11; threshold ≥ 2; evidence: side-by-side comparison of Leo print preview and sample docx.

## Task 9: End-to-end verification with live Y4 data and error states
- **Status**: pending
- **Priority**: medium
- **Depends On**: Task 8
- **Description**:
  - Run the complete Leo flow against the live API (list → reports → protocol → draft → print); also verify a second student (Catherine 27) builds a coherent draft despite shorter protocol; verify rate-limit/abort/network-failure messages and that failed fetch leaves no orphaned misleading state.
- **Acceptance Criteria Addressed**: AC-4, AC-7
- **Test Requirements**:
  - `rule` TR-9.1: Both real students complete the flow; failed/cancelled protocol fetch shows Chinese error and allows retry without duplicate rows. Evidence: recorded verification notes.
  - `rule` TR-9.2: Reopening either report performs zero upstream protocol calls. Evidence: network panel.

## Task 10: Regression, build, and 一表人才 non-disruption pass
- **Status**: pending
- **Priority**: high
- **Depends On**: Task 9
- **Description**:
  - Run full Jest suite, `npm run build`; manually pass through student routes and all `/mentor` tabs; verify switch/landing on desktop widths; confirm session/sessionStorage behavior unaffected.
- **Acceptance Criteria Addressed**: AC-10, AC-13
- **Test Requirements**:
  - `rule` TR-10.1: `npm test` all green and `npm run build` succeeds. Evidence: command output.
  - `rule` TR-10.2: `/mentor` tabs (学生管理/数据分析/课表/系统设置) and student `/syllabus /learning /review /notifications` behave as before. Evidence: manual checklist results.
  - `rubric` TR-10.3: Non-disruption; scale 0-3; threshold ≥ 2 per AC-13; evidence: comparison walkthrough.
