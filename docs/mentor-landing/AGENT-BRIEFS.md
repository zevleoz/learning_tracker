# Handing the remaining work to flash agents

The spec is `docs/mentor-landing/PLAN.md`. This file tells you how to set each agent up and gives you a brief to paste into each one.

**Already done:** WS-1 (AI facts and prompt) and WS-2 (nightly job, SQL patch v2). Both are merged into the local branch `mentor-landing`.

**Left to do:**

| WS | What | Context window | Can start |
|---|---|---|---|
| WS-3 | `useDrafts` hook, wording 新生→首月, 全部学生 table | standard | now |
| WS-4 | 今天 tab: message card, queue, week board | standard | now |
| WS-5 | small messages panel at the top of 数据分析 | standard | now |
| WS-7 | Back/Forward between E4 and 一表人才 | standard | now |
| WS-6 | wire it all into `Mentor.jsx`, click → 数据分析, URLs, harness | **1M** (or a stronger model) | after WS-3, WS-4, WS-5 and WS-7 are merged |

**1M context or not:**
- WS-3, WS-4, WS-5 and WS-7 each read about 60–120 KB: their part of the plan, the mockup and a few small files. A standard context window is enough.
- WS-6 has to read `src/pages/Mentor.jsx` (about 110 KB), the tests and all the new components, so it needs about 300 KB before it writes anything. Use the 1M-context flash model for it, or a stronger model.
- Tell every agent **not** to read `src/index.css` (14,000 lines). No workstream needs it.

---

## 1. Set up one worktree per agent

Run these from the repo root. Putting worktrees under `.claude/worktrees/` keeps them out of git, and lets them use the main checkout's `node_modules` without another `npm install`.

```bash
git worktree add .claude/worktrees/ml-ws3 -b ml-ws3 mentor-landing
```

```bash
git worktree add .claude/worktrees/ml-ws4 -b ml-ws4 mentor-landing
```

```bash
git worktree add .claude/worktrees/ml-ws5 -b ml-ws5 mentor-landing
```

```bash
git worktree add .claude/worktrees/ml-ws7 -b ml-ws7 mentor-landing
```

Start each agent with its working directory set to its own worktree folder. Then paste the shared preamble (section 2), followed by that agent's brief (section 3).

---

## 2. Shared preamble (paste first into every agent)

```
You are working in the 一表人才 repo (React 18 + Vite + Supabase). Your working directory is a git worktree on your own branch; stay inside it.

Read docs/mentor-landing/PLAN.md: the "Decisions" list, "Rules for every workstream", Part 2 (contracts C1–C5), and the section for your workstream. That is your spec. Read other sections only if something is unclear. Do not read src/index.css (14,000 lines); you don't need it.

Hard rules:
- Edit or create only the files your workstream "Owns". If you need a change anywhere else, don't make it; list it under "Follow-ups" in your final report.
- No new npm dependencies. Never run SQL or call Supabase or an LLM for real; tests use the mocks in src/__mocks__.
- Never write 「新生」 in UI text or comments; use 首月. Chinese UI copy is short and plain. System fonts only; no emoji, glows, pill clutter or hover-lift.
- Run tests with `npx jest -w 3` (the default worker count times out on this machine). Your own tests first, then the full suite. Also run `npm run build`. Everything must pass, except failures you can show existed before your change.
- Commit to your branch with Chinese commit messages in the repo's style, e.g. `feat(学生管理)：…`. Never push. Never switch branches or touch other worktrees.

Final report (under 250 words): branch name and commit hashes, files changed, test and build results, any deviation from the plan, and Follow-ups.
```

---

## 3. Briefs (paste after the preamble)

### WS-3 · data hook and wording

```
Your workstream is WS-3 in docs/mentor-landing/PLAN.md ("Client data hook and wording").
Also read: C1, C3 and C4 (the WeekBoard row shape) in Part 2, and the existing files you own: src/components/mentor/useDrafts.js, fillInfo.js, FillStrip.jsx, StudentTable.jsx, StudentCards.jsx, plus __tests__/mentorFillInfo.test.js.
The C3 constants (SNOOZE_DAYS, SKIP_REASONS, …) already exist in src/lib/supervision.js; import them, don't redefine them.
useDrafts must return exactly the C3 shape. Other agents are building components against it right now.
For the 全部学生 table's look, open the "全部学生" tab of docs/mentor-landing/design.html in a browser, or read its allHtml() function.
```

### WS-4 · 今天 tab components

```
Your workstream is WS-4 in docs/mentor-landing/PLAN.md ("今天 tab components").
Also read: C1, C3 and C4 in Part 2.
The visual spec is docs/mentor-landing/design.html, which is interactive: open it in a browser and try every button. The functions msgHtml(), todayHtml() and the CSS for .msg, .done, .menu and .tbl are what you're rebuilding as React components. The sidebar in that file is not yours.
WS-3 is building the real useDrafts hook in parallel. Build and test against a stub `dr` object with the C3 shape; don't import useDrafts.
Clicking a student's name calls onOpenStudent(id). Don't navigate yourself; WS-6 wires it to 数据分析.
Put all CSS in src/styles/mentor-desk.css, scoped under .md-root, and import it from your components.
```

### WS-5 · messages panel on 数据分析

```
Your workstream is WS-5 in docs/mentor-landing/PLAN.md ("Student messages panel (top of 数据分析)").
Also read: C3 and C4 in Part 2.
Visual reference: in docs/mentor-landing/design.html open a student (click a name). Use only its 「今天的消息」 and 「发过的消息」 blocks. The rest of that student page is no longer built.
Import MessageCard from src/components/mentor/MessageCard.jsx. WS-4 is building it in parallel, so in your tests mock that module (jest.mock) with a simple stand-in that renders the draft text. If the file doesn't exist yet when you build, create nothing there; just make sure your tests mock it, and note it in your report.
Build against a stub `dr` with the C3 shape (in particular dr.loadHistory).
```

### WS-7 · platform navigation

```
Your workstream is WS-7 in docs/mentor-landing/PLAN.md ("Platform navigation (E4 ⇄ 一表人才)").
Also read: decision 10, and C5 in Part 2. Then read only these files: src/components/WorkspaceSwitch.jsx, src/App.jsx, src/pages/lazyRoutes.jsx, src/components/E4Layout.jsx, the line in src/pages/e4/E4StudentDetailPage.jsx that links to /mentor?student=, src/lib/useAuth.js, and __tests__/App.routes.test.jsx.
Do not edit src/pages/Mentor.jsx. WS-6 will call your rememberWorkspacePath() from there later.
After your tests pass, check the E4 half of the browser sequence in WS-7 step 7 in the local harness: run `npx vite --config vite.harness.config.js` and open http://127.0.0.1:5199/e4. The harness logs in a fake admin mentor.
```

---

## 4. Merge the four branches

When the four agents report back:

1. Skim each report: a deviation from the plan, or a Follow-up that touches someone else's file, needs your decision.
2. Merge them into `mentor-landing` from the main checkout. They don't share files, so the order doesn't matter.

```bash
git switch mentor-landing
```

```bash
git merge --no-ff ml-ws3 ml-ws4 ml-ws5 ml-ws7
```

```bash
npx jest -w 3
```

If you'd rather I review and merge them, send me the four branch names.

---

## 5. WS-6 (after the merge)

Create its worktree from the updated `mentor-landing`:

```bash
git worktree add .claude/worktrees/ml-ws6 -b ml-ws6 mentor-landing
```

Use the **1M-context** flash model (or a stronger one). Paste the shared preamble, then:

```
Your workstream is WS-6 in docs/mentor-landing/PLAN.md ("Integration in Mentor.jsx + harness"). WS-3, WS-4, WS-5 and WS-7 are already merged into your branch; their components and src/lib/workspaceNav.js exist. Read their files rather than guessing their props.
Also read: decisions 9 and 10, and all of Part 2.
src/pages/Mentor.jsx is about 2,400 lines with a desktop branch (~line 1054 onward) and a mobile branch (~line 1782 onward). Read it in ranges, and change both branches.
The most important behaviour:
(1) clicking any student goes to /mentor?view=analytics&student=<id> with no pop-up, and the Sheet is removed;
(2) view, tab and student live in the URL, so Back/Forward walk through 一表人才's own pages (push for clicks, replace for the select, search and filters);
(3) the 今天 / 全部学生 tabs.
The harness files .harness/mentorData.js and scripts/harness-supervision-plugin.mjs are in the main checkout. .harness is git-ignored, so edit it in the main checkout at /Users/jefflau/projects/一表人才/.harness/ and say so in your report.
Finish by running the browser sequence in WS-7 step 7 and the harness checks in WS-6 step 10. Run the harness with `npx vite --config vite.harness.config.js` (port 5199). Report anything that didn't work.
```

Then merge `ml-ws6` into `mentor-landing` the same way.

---

## 6. Before deploying

1. Dry-run the AI on the sample records and read the output. It needs `LLM_API_KEY` (and `LLM_BASE_URL` / `LLM_MODEL` if not the default) in your shell. It prints the facts, the message, the alternatives and any problems for each sample.

```bash
node scripts/supervision-dry-run.mjs --kind nudge
```

Also run it with `--kind daily` and `--kind weekly`, and add `--times 3` to check the output is stable.

2. Run `supabase/schema.patch-supervision-v2.sql` in the Supabase SQL editor (after the v1 patch).
3. Only then deploy. Remember that pushing `main` deploys production. Use a preview branch first if you want to check on a phone.
