# Context brief: mentor-side changes (一表人才 tracker + E4)

For an agent planning changes to the mentor side. Read this first, then the user's list of changes (last section). Plan only: do not implement until the user approves the plan.

## The product

One React 18 + Vite + Supabase web app on Vercel, one domain, three surfaces that share login and database:

| Surface | Routes | Who | Main files |
|---|---|---|---|
| Student side | `/today` `/records` `/insights` `/me` `/me/courses` `/me/reminders` `/login` `/signup` | students (`profiles.role = 1`) | `src/pages/student/*`, `src/pages/Learning.jsx`, `src/components/Layout.jsx` |
| Mentor tracker (一表人才导师台) | `/mentor` | mentors and admins (`role >= 2`; 3 = admin) | `src/pages/Mentor.jsx` (~2,250 lines), `src/components/MentorLayout.jsx`, `WeekReviewDashboard.jsx`, `DeepDivePanels.jsx`, `DimensionStrip.jsx`, `WeekGrid.jsx`, `DayDetailPanel.jsx`, `src/utils/consultant.js` |
| E4 learning-coach platform | `/e4*` | mentors | `src/pages/e4/*`, `src/components/e4/*`, `src/components/E4Layout.jsx`, `src/lib/e4*.js`, `api/y4/` (Y4 proxy), `api/llm/` (LLM endpoints) |

Mentors land on `/mentor` or `/e4` according to `profiles.default_workspace` (the last one opened), and switch between them with `WorkspaceSwitch`. Mentor tracker tabs, in `MentorLayout`: 学生管理 · 数据分析 · 课表 · 系统设置. The E4 sidebar has 工作台 (待办事项, students, the report builders) and 最近查看. `HANDOFF.md` describes E4 in depth.

## Data and access

- Supabase (Postgres + RLS), with no backend business layer. The tables that matter here:
  - `profiles` (with `role`, `school_name`, `created_at`, `default_workspace`, `notification_prefs`)
  - `learning_sessions`
  - `exam_scores`
  - `courses` / `chapters` / `units`
  - `teacher_student_connections` (status 0 invited, 1 connected, 2 rejected)
  - the `e4_*` tables
  - the new `push_subscriptions` and `push_deliveries`
- Mentors read a student's data only when connected, via RLS `is_connected_teacher_of()`. Admin is auto-connected to all students.
- Schema changes are manual SQL files run by the user in the Supabase SQL editor. There is no migration pipeline: the current patches are in `supabase/`, older ones in `supabase/archive/` and `supabase/migrations/`. **There is one production database shared by every surface, with real users.** Write idempotent patches and never run anything against it yourself.

## Rules that must not change

- **主观评价 / 客观评价 data rules**, which mentor analytics read:
  - 主观 is always saved as `self_rating` 20/40/60/80/100, with student labels 没有听课 / 像在听天书 / 有不少没掌握 / 基本掌握 / 完全掌握. Formal report labels are in `src/lib/rating.js`.
  - 客观 exists only for 练习 (`category = 3`) as a letter grade F…A+ or `'N/A'`.
  - 待补填 = `category 3`, `grade_label` null, `score` null, not deleted.
  - The rules live in `src/lib/sessionRules.js`. Don't rename or relabel them.
- **No minutes goal anywhere,** and **no rest-day quota.** An empty day may be labelled 休息, but there is no allowance.
- **Notifications stay non-intrusive.** Mentor-facing changes should not create new student pushes without the user's say-so.
- **Never push to GitHub `main`:** pushing `main` deploys production through Vercel. Work on local branches. For phone or real-device testing, the user approves pushing a **non-main** preview branch. Currently `student-redesign-preview` gives a Vercel preview URL with a Deployment Protection Exception.
- **UI quality:** the user rejects generic AI-looking UI. That means no outlined cards everywhere, no pill clutter, no decorative numbering, no emoji, no glows, and no hover-lift on every card. Use one accent red (crest `#A3202A`) and system fonts only, because mainland China users can't rely on Google Fonts. Copy is Chinese, short and plain.

## What changed in student v2 (relevant to mentors)

All of this is on local `main`, 33+ commits ahead of GitHub `main`, and not deployed to production yet.

- **New student routes:** `/learning` → `/records`, `/review` → `/insights`, `/syllabus` → `/me/courses`, `/notifications` → `/me`. The old paths redirect. Mentor-side links into student pages, if any, should use the new paths.
- **New shared libraries a mentor view can reuse:**
  - `src/lib/studentStats.js`: pure functions for minutes by category, week-over-week, streak (consecutive days with records), 待补填, subject breakdown, 自评 vs 实测 calibration, and a headline insight.
  - `src/lib/sessionRules.js`: the record save rules.
- **Design tokens:** `src/styles/tokens.css` defines the `--yb-*` tokens, with dark mode scoped to `.yb-student`. Mentor CSS still uses the older `--mentor-*` variables in `src/index.css`, and E4 uses its own theme (`body.e4-light`, `.e4-dashboard`). Never put a global `.dark` class on `<html>`; it leaks into other surfaces.
- **Notifications backend** (`api/notify/index.js`, `api-lib/notify.mjs`, `api-lib/notify-email.mjs`):
  - Student pushes: a nudge after 3 days without a record and again at day 7, a daily reminder forced on in the first 30 days, mentor invites sent immediately, and a day-3 email fallback.
  - An invite push is sent by `POST /api/notify {"type":"invite","student_id","teacher_name"}` with `NOTIFY_SECRET`, or by a Supabase database webhook on `teacher_student_connections` inserts. The mentor invite UI in `Mentor.jsx` does not call it yet.
- **Update prompt:** `src/lib/useAppUpdate.js` compares per-surface hashes in `/version.json`, so a student-only change never prompts mentors and vice versa. Keep that split in mind.
- **Global `index.css`:** student v2 rewrote large parts of it. Mentor and E4 sections were meant to be left alone, but check `/mentor` and `/e4` visually before and after any CSS change.

## Existing mentor-side plan already in the repo

`PLAN-e4-todos-mentor-stats.md` (repo root, untracked) is a self-contained plan written before v2. It covers two things: correcting the 「已过期」 grouping on the E4 待办事项 page, and removing the top stats bar from the 一表人才 mentor tracker. Check whether the user still wants it before folding it in.

## How to work here

- Tests: `npx jest -w 3`. The default worker count times out on this machine. Mocks live in `src/__mocks__/`; Supabase and auth are mocked through `jest.config.js` `moduleNameMapper`.
- Build: `npm run build`.
- Visual checks without production login: the git-ignored harness `vite.harness.config.js` + `.harness/` (fake Supabase/auth with sample data), run with `npx vite --config vite.harness.config.js` on port 5199. It currently fakes a student; extend it with a mentor profile and connections to see `/mentor` and `/e4`.
- Delegation: the user wants token-efficient work. Prefer splitting into independent pieces with explicit file ownership (no two pieces edit the same file), cheaper models for well-specified pieces, and local branches the user merges after review.

## The user's requested changes

_(The user will add the specific mentor tracker and E4 changes here.)_

1.一表人才监督流程

第一个月：
每天进行反馈
已经填：一句表扬（具体到什么内容做得好）
未填写：收集起来给我汇总


后续：
每周进行反馈，一段总结表扬，以及中间有什么可能存在的问题
连续三天未填写：汇总给我

essentially, this function needs ai (can reuse dashchope api key used in e4). it is for the mentor side of 一表人才. make sure you understand what i mean, we can discuss
2.
3.

## What the plan should contain

For each change:
- the goal in one line
- the files involved
- any data or RLS impact, and the exact SQL if needed
- the risks to real users and to the other two surfaces
- how to test it, including what can be checked in the harness

Then propose an order of work, and which pieces can run in parallel without touching the same files.
