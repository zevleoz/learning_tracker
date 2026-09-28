# E4 学习力导师平台 — Phase 1: E4 Shell + 首次学习力分析报告 PDF

## 1. Background

The current product is **一表人才**, a learning tracker whose mentor side is a data-analysis dashboard. It is becoming the first tool inside a larger framework: **E4 学习力导师平台**. E4 is student-centric and meeting-driven; 一表人才 remains independently usable and shares the same domain and Supabase database.

This phase introduces the E4 framework surface and its first functional tool: a **dynamic PDF generator for the E4 首次学习力分析报告 (first-meeting report)**, combining:

1. **Y4 data** — a separate assessment system (凭远 Y4 综合测评) accessed via a read-only REST API. The key input is the **E4 评估协议 markdown** (`GET /api/v1/reports/{id}/e4-protocol`), an AI-generated, machine-oriented protocol built on Y4 results.
2. **Meeting minutes** — free-text pasted into the site by the mentor after the first E4 meeting.

A second PDF type (**过程中报告**, combining meeting data with 一表人才 tracker data) exists in the product vision but is explicitly out of scope for this phase.

### Verified facts from real data (2026-09-20)

- Y4 API base: `https://report.p4learning-ark.app/api/v1`, auth `Authorization: Bearer <Y4_API_KEY>`, rate limit 60/min, CORS open, error shape `{ok:false,error}`.
- Relevant endpoints: `GET /students`, `GET /students/{id}/reports`, `GET /reports/{id}` (meta), `GET /reports/{id}/y4-md`, `GET /reports/{id}/e4-protocol` (AI-generated live, 10–30s, observed up to ~27KB), `GET /reports/{id}/pdf`.
- E4 protocol v1.2 structure confirmed across two students (ids 25, 27): sections `META`, `E4_EVALUATIONS`, `OTHER_VARIABLES`, `OVERVIEW`, `Y4_INTERPRETATION`, `EXPERT_JUDGMENTS`, `名单归属`; dimensions `E1 · Emotion`, `E2 · Energy`, `E3 · Engine`, `E4 · Engagement`; 27 `####` questions total (E2 has no sub-questions — it is a single verdict block).
- Per question: `[VERDICT] <label> | [LIST] <label> | <topic>`, zero+ `[EVAL] <metric> | <value> | note:...` and `[REF] <metric> → 见首次出现维度` lines, then a `判断：...` paragraph.
- Observed VERDICT labels: 健康, 中性, 关注, 需支持, 需介入. LIST labels: 强潜能, 弱潜能, 弱干预, 强干预.
- Sample PDF template provided: `E4首次学习力分析报告_更新版(2).docx` (student "Leo", who is Y4 student id 25 / report id 25 — usable as the end-to-end reference case).

## 2. Users

- **Mentor (role 2)** and **admin (role 3)** only. Students get no E4 access in this phase.
- The mentor manually creates an E4 student record and manually identifies which Y4 student/report belongs to that E4 student.

## 3. Goals

1. Add an E4 framework surface with a student-centric workflow, reachable as the **default landing** for mentors/admins, with a persistent workspace preference (E4 vs 一表人才) and a one-click switch.
2. Securely integrate the Y4 API without exposing the API key in client code.
3. Parse the E4 protocol markdown into structured data and map it onto the fixed first-meeting report template.
4. Let the mentor paste free-text meeting minutes, review and correct a pre-filled report matrix, and generate a print-ready HTML view that exports to PDF via the browser print dialog, matching the provided sample layout.
5. Persist report records (protocol snapshot, minutes, confirmed data) so reports can be reopened and regenerated.
6. Keep all existing 一表人才 functionality intact; existing UI changes are additive (navigation entry + switch only), no overhauls.

## 4. Non-goals

- 过程中报告 PDF and any 一表人才 tracker-data integration into PDFs.
- The E4 meetings/course framework (scheduling recurring meetings, meeting types beyond the first).
- Student-facing E4 pages or student login behavior changes.
- Automatic/AI extraction of structured fields from the pasted minutes text (v1 uses a human review step; a side-by-side minutes view assists entry).
- Writing data back to the Y4 system (the API is read-only; undocumented `/students/{id}/minutes` POST route is not used).
- Importing/listing Y4 PDF or Y4 markdown beyond what is needed to preview the source (y4-md link is optional, low priority).
- Renaming or restructuring existing 一表人才 routes/components.

## 5. Functional Requirements

### 5.1 Workspace shell, landing, and switch

- F1. Authenticated users with role ≥ 2 who hit `/` are taken to their preferred workspace; default preference is **E4** (`/e4`). Existing student redirect behavior is unchanged.
- F2. A per-user landing preference (`e4` | `tracker`) is persisted in Supabase; the user can change it in the existing 系统设置 area and via the switch control.
- F3. A persistent quick-switch control is visible in the mentor sidebar and the E4 sidebar, jumping between `/e4` and `/mentor` without losing auth state.
- F4. E4 uses the mentor desktop layout convention (desktop-first at all widths, consistent with existing mentor pages).

### 5.2 E4 student records (student-centric)

- F5. Mentors/admins can create an E4 student manually: name as used in E4 reports (mentor decides whether it is a 化名; stored as one display-name field), optional gender/grade/school, optional advisor (defaults to creator), optional link to a 一表人才 `profiles.id` (unused this phase except display; needed for the future 过程中报告).
- F6. Each E4 student is manually linked to a Y4 student and one of that student's Y4 reports, chosen through the API (search/list Y4 students → list reports → select). Linking can be deferred or changed before a first report is generated.
- F7. The E4 student list and a student detail "dashboard" exist; detail shows profile fields, Y4 link status, linked tracker student, and the list of generated reports with status (draft/final) and dates.
- F8. Editing basic fields and the Y4 link is supported. Hard delete is out of scope (no destructive action in v1).
- F9. Visibility model (proposed, see OQ-1): all mentors/admins see the shared E4 student pool; `advisor_id` records ownership; admins see everything regardless.

### 5.3 Y4 API integration

- F10. All Y4 calls go through a same-origin server proxy that injects `Y4_API_KEY` from server environment variables. The key must never appear in client bundles, git-tracked files, or browser-visible requests.
- F11. Proxy endpoints needed: list students (`?q=` search passthrough if supported, else client-side filter), list reports for a student, fetch one report's E4 protocol, (optional) fetch y4-md.
- F12. The E4 protocol request tolerates 10–30s response times (server function timeout ≥ 60s; UI shows a progress/loading state and never blocks the main thread).
- F13. Error states for 401/404/429/503 and network failure are surfaced with actionable Chinese messages; 429 prompts retry-after; failures do not corrupt saved drafts.
- F14. Local development works through a Vite dev middleware equivalent of the proxy (the local network resets TLS when SNI = the Y4 host; the dev middleware connects with no domain SNI + correct Host header; production serverless connects normally).

### 5.4 Protocol parser and template mapping

- F15. A standalone parser module converts protocol markdown v1.2 into: meta, dimensions (E1–E4) with questions, each question's verdict/list/topic/evals/refs/judgment, other variables/orders/norms, core problems, watch items, follow-up leads, overview strengths, roster classification (名单归属), and the raw Y4 interpretation.
- F16. A fixed template definition declares every row of the four checklists exactly as in the sample docx, mapping each template row to protocol questions via stable keyword aliases:
  - Emotion: 8 rows (学习自信程度 / 学校环境的负面影响 / 亲子关系对学业情绪的影响 / 整体自卑状态 / 焦虑状态 / 高敏感与内耗 / 不开心或情绪低落 / 安全感状态).
  - Energy: 4 main rows from the E2 block evals (睡眠习惯 / 饮食习惯 / 运动习惯 / 身体状态与自我感受) + 3 meeting-only supplement rows (日间精力 / 学习时段 / 其他身体因素).
  - Engine: 11 rows (信息输入 / 信息存储 / 信息分析 / 信息加工速度 / 专注与抑制控制 / 工作记忆 / 认知灵活性 / 整体学习动机 / 成功动机 / 深层学习动机 / 内驱力状态).
  - Engagement: 7 main rows (数理逻辑策略 / 空间能力策略 / 理解型策略 / 记忆型策略 / 学习方法使用程度 / 计划性 / 元认知潜力) + 5 meeting-only supplement rows (任务启动 / 干扰管理 / 困难任务回避 / 主动求助 / 时间分配).
  - Protocol items without a template row (e.g. 确定性需求) are retained in an "additional clues" bucket and may feed section-07 drafting; they are never silently dropped.
- F17. The parser/mapping is deterministic, tolerant of missing values/notes/sections, and covered by Jest tests using the two fetched real protocol fixtures (Leo id 25, Catherine id 27), which are stored under `__tests__/fixtures/` **with the API key absent** (fixtures contain only response bodies).

### 5.5 Report builder flow

- F18. From an E4 student detail, mentor starts "生成首次报告": a stepper guides (1) confirm Y4 student/report → fetch E4 protocol (snapshot stored immediately); (2) enter meeting date/report date (report date defaults to today) and paste meeting minutes as free text; (3) review matrix; (4) preview & print.
- F19. Review matrix pre-fills each template row:
  - **排查项目**: fixed label (read-only).
  - **Y4初步线索**: auto-drafted from the mapped question's evals/refs + condensed judgment (e.g. metric short name + value), fully editable multiline text. Meeting-only supplement rows start empty and are marked as such.
  - **会议核实情况**: starts empty; the pasted minutes remain visible side-by-side (or in a toggle panel) while the mentor fills each cell.
  - **综合判断**: dropdown with exactly the four report states — 已确认问题 / 可能存在 / 暂未发现 / 信息不足. Default mapping from VERDICT: 健康·中性 → 暂未发现; 关注·需支持·需介入 → 可能存在; the mentor alone can set 已确认问题.
- F20. Per-section narrative boxes (当前核心发现; 后续观察 / 实际学习影响 / 可利用优势 per the docx) are editable; sensible drafts are derived from protocol judgments/core problems/overview strengths where available, blank otherwise.
- F21. Section 07 (综合判断) is a fully editable page with explicit prompts that make the mentor's required inputs obvious:
  - **家庭最初反映引述** and **学生自述引述**: start empty; mentor excerpts them from the meeting minutes (minutes panel stays reachable, e.g. pop-out/side panel; copy-into-field interaction is provided where practical).
  - **已确认的关键问题 table**: auto-derived from checklist rows set to 已确认问题, grouped across the four E dimensions — only dimensions with confirmed problems appear (E position + 当前核心发现 text); entries remain editable/deletable.
  - **问题解决方案 table** (成长方向 | 简要安排): starts empty; friendly add/remove-row UI in the exact two-column format; mentor writes all content. No prefilled content.
  - **下次复盘**: two required fields — 时间 and 重点验证 — both start empty and are filled by the mentor; print/最终版 is blocked while either is empty.
  - Every element on the page is editable; placeholders/prompts guide the mentor rather than AI-drafted text.
- F22. The report can be saved as draft at any step (inputs + current form state), reopened, and resumed. Generating/printing does not require marking final; a "标记为最终版" action is available but not enforced.

### 5.6 Print / PDF output

- F23. A dedicated print route renders the report exactly in the sample structure: cover (branding E4 · LEARN WITH EASE, title 首次学习力分析报告, subtitle, intro line, student/grade/school/Y4 date/meeting date/report date/报告性质/证据来源, fixed 保密说明), section 02 如何阅读 (static framework copy including the four E's and four judgment states), sections 03–06 checklists with 4-column tables and supplement tables plus narrative boxes, section 07 综合判断 with quotes, confirmed-issues table, growth-direction table, and next-review block.
- F24. Output is A4 print-optimized CSS (`@page`, page breaks between major sections, repeated headers where feasible, no on-screen chrome in print). "下载 PDF" opens the browser print dialog (Save as PDF). CJK renders with system Chinese fonts; no external font payload.
- F25. Visual design follows existing product conventions and user preferences: neutral black/gray text (#0f172a / #94a3b8 accents), no emojis, no red/green/yellow evaluation color coding — the four judgment states are text only, consistent with the sample.
- F26. All report text comes from confirmed form data; a cell never prints a parser placeholder, raw `[EVAL]` token, or `undefined`. Empty optional cells print as "—" or an intentionally blank line.

### 5.7 Data persistence and security

- F27. New tables (Supabase migration patch, idempotent, RLS-enabled):
  - `e4_students`: id, display_name, gender, grade, school, advisor_id → profiles, y4_student_id int null, y4_report_id int null, tracker_profile_id uuid null → profiles, notes, created_by, timestamps.
  - `e4_reports`: id, e4_student_id → e4_students cascade, report_type (`first`; future `progress`), status (`draft`|`final`), meeting_date date, report_date date, minutes_text text, protocol_md text, protocol_fetched_at, form_data jsonb, created_by, timestamps.
  - `profiles.default_workspace varchar not null default 'e4'`.
- F28. RLS: mentors/admins (role ≥ 2) can select/insert/update all E4 rows; students have no access; mutation of `default_workspace` allowed only on one's own profile (via self-update policy or RPC consistent with existing profile-update conventions).
- F29. Y4 credentials live in `Y4_API_KEY` (server env only; `.env.example` gets a placeholder, `.env.local` holds the real local value and stays git-ignored).

## 6. Non-functional Requirements

- N1. Existing Jest suites pass; new unit tests cover parser + mapping; `npm run build` succeeds.
- N2. No existing route changes behavior for students; `/mentor` and all its tabs work as before.
- N3. All UI text is Chinese (English subtitles per template), no emojis, modals/panels stay fully inside the viewport per existing conventions, transitions smooth.
- N4. Long protocol fetches provide clear progress feedback and allow cancel; re-opening a saved report never re-calls the e4-protocol endpoint (snapshot is used), avoiding repeated AI-generation cost.
- N5. Mobile is not a target for E4 authoring (desktop-first mentor tool), but print output must be correct regardless of window width.

## 7. Constraints, Dependencies, Assumptions

- Deployment is Vercel (static SPA + rewrites); the proxy is implemented as a Vercel Node.js serverless function under `/api`, compatible with the current `vercel.json`.
- The Y4 host is directly reachable from Vercel's network; the SNI-reset workaround is local-dev only.
- The browser print-to-PDF approach is accepted; layout fidelity targets the sample docx but pixel-identical reproduction is not a requirement (rubric-evaluated).
- Protocol format is v1.2; unknown future sections/tags are preserved in raw form and ignored gracefully.
- One Y4 report feeds one first report; if a student has multiple Y4 reports the mentor picks the correct one manually.
- Minutes are unstructured free text; v1 deliberately puts a human in the loop rather than guessing field mappings.

## 8. Resolved Decisions (approval gate, 2026-09-20)

- D1. **Shared E4 student pool** — all mentors/admins see all E4 students; `advisor_id` records ownership; admins see everything.
- D2. **Section 07 is mentor-written, not AI-drafted** — quotes are excerpted by the mentor from minutes (UI assists copy-in); confirmed-issues table auto-groups confirmed rows across the four dimensions and is editable; solution table and next-review (时间 + 重点验证) start empty with clear prompts; 时间/重点验证 required before 最终版/print.
- D3. **报告性质** defaults to "首次学习力分析报告", editable per report.
- D4. **Debounced autosave** of drafts + explicit 标记最终版.

## 9. Acceptance Criteria

### Rule-type

- AC-1: A role-1 (student) account cannot read or write any `/api/e4*` data route or E4 table; direct Supabase queries on `e4_students`/`e4_reports` return no rows. Evidence: RLS policies + a test/query demonstration.
- AC-2: After login, role ≥ 2 users land on `/e4` when `default_workspace='e4'`, and on `/mentor` when `'tracker'`; changing the setting flips the next `/` redirect; student `/` redirect is unchanged. Evidence: route/redirect code + manual verification.
- AC-3: No file committed to git contains the real Y4 API key; `grep` for the key value over tracked files returns nothing; the client only calls same-origin `/api/y4/*`. Evidence: git grep + network inspection.
- AC-4: The proxy returns parsed student/report lists from the live Y4 API and streams the e4-protocol markdown for report 25; a missing/invalid key surfaces a clear error state in the UI. Evidence: local end-to-end run against the live API.
- AC-5: Parser tests pass on both real protocol fixtures: all 4 dimensions parsed; 27 questions for Leo (E1=8, E2 block, E3=11, E4=8); every verdict, eval, ref, and 判断 captured; parser does not throw on truncated input. Evidence: Jest output.
- AC-6: Template mapping covers all 30 checklist rows (8+4+3+11+7+5 including supplements) for Leo; the 确定性需求 item lands in additional clues; every mapped Y4 clue cell for Leo contains content derived from his protocol. Evidence: test snapshot/manual Leo run.
- AC-7: A complete first report can be created for the Leo E4 student end-to-end: create E4 student → link Y4 25/25 → fetch protocol → paste sample minutes → edit matrix → save → reopen without refetch → open print view. Evidence: manual verification + persisted rows.
- AC-8: The print view contains the sample report's full section structure (cover, 02, 03–06 with correct row labels and tables, 07) and prints without page-chrome; choosing 下载 PDF opens the print dialog. Evidence: print preview in browser.
- AC-9: Every judgment cell prints one of the four exact Chinese states; no `undefined`, `[EVAL]`, `[VERDICT]`, or empty unmarked cell appears in print output. Section 07's 时间 and 重点验证 are enforced as required before 最终版/print; solution rows and quotes print exactly what the mentor entered (no system-drafted content). Evidence: print HTML inspection + validation walkthrough.
- AC-10: Existing test suites (`__tests__/*`) and `npm run build` pass after the changes; `/mentor` tabs and student routes are behaviorally unchanged. Evidence: CI-equivalent local run.

### Rubric-type

- AC-11: **PDF fidelity to sample (0–3)**: 0 = structure differs materially; 1 = all sections present but weak hierarchy/spacing; 2 = close to sample with minor typographic differences; 3 = visually reads as the same document family (cover, tables, section flow, type scale). Pass threshold: ≥ 2. Evidence: side-by-side print preview vs docx.
- AC-12: **Review workflow usability (0–3)**: 0 = manual re-entry of most data; 1 = prefill works but correction is clumsy; 2 = most cells prefilled correctly, minutes easily consultable, all cells quickly editable; 3 = mentor can produce a corrected report in minutes with minimal typing and clear provenance of every prefilled value. Pass threshold: ≥ 2. Evidence: guided walkthrough with mentor user.
- AC-13: **Non-disruption of 一表人才 (0–3)**: 0 = existing flows visibly changed/broken; 1 = additive UI intrudes on existing layout; 2 = existing UI intact, switch is neutral; 3 = existing UI intact and the switch feels native to current navigation. Pass threshold: ≥ 2. Evidence: regression pass on /mentor and student pages.
