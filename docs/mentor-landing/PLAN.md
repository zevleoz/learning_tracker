# 学生管理首页改版 + AI 消息草稿 v2 · Implementation plan

Visual spec: `docs/mentor-landing/design.html`. Open it through the harness at http://127.0.0.1:5199/docs/mentor-landing/design.html. The top bar switches between the mentor and admin views. The notes at the bottom of the page are part of the spec.
Background: `docs/MENTOR-SIDE-CONTEXT.md` and `docs/mentor-e4-audit/PLAN.md` (WS-C built the current supervision backend).

Scope: the 学生管理 view of the mentor tracker (`/mentor`) and the supervision draft pipeline (`api-lib/supervision*.mjs`, `api/supervision`). The sidebar, 数据分析, 课表, 系统设置, E4 and the student side are out of scope.

## Decisions already made (user, 2026-10-26)

1. **Copying a draft counts as sent.** There is no separate 已发 button, and copying can be undone.
2. **过几天再说** offers only 3, 5 or 7 days. When the draft comes back it is **rewritten from the latest records**, not restored. A reminder is dropped automatically if the student records something in the meantime.
3. **At least 3 days between two reminders** to the same student. This does not apply to praise.
4. **Admins can do everything a mentor can,** including copying, editing, snoozing and skipping any draft they can see. Because two people can now act on the same draft, every handled row shows who handled it and when. (Later: once a student is assigned to a mentor, admins become read-only on that student's drafts. **Not in this plan.**)
5. **Never write 「新生」 in the UI or the prompt.** Use **首月** (「首月 · 第 13 天」) or 新注册. After day 30 it is 「每周看」.
6. **Gentle reminders also get AI drafts** in the same queue as praise. **One message per student per day:** on a Monday, a weekly summary and a reminder for the same student become a single message.
7. **Tabs and pages (proposed in the mock; confirmed by "go ahead with the plan"):**
   - 学生管理 gets two in-page tabs: **今天** (default) and **全部学生**. The sidebar does not change.
   - Student detail becomes **its own page** inside 学生管理, replacing the right-hand Sheet.
8. **顾问 vs 导师.** 顾问 (Angela, Jason) is parsed from the bracket in `mentor_alias` (`src/utils/consultant.js`) and is not an account. 导师 is the logged-in teacher account.

## Rules for every workstream

1. **No push, no PR.** Commit only to your own local branch, named `ml-<ws>` (e.g. `ml-ws1`). Pushing `main` deploys production.
2. **Edit only the files your workstream owns** (listed in each section). If you need a change elsewhere, write it under "Follow-ups" in your report.
3. **No new npm dependencies.**
4. **主观评价 / 客观评价 rules stay as they are** (`src/lib/sessionRules.js`, `src/lib/rating.js`).
5. **No minutes goal.** Never praise or criticise total time, and add no minute thresholds.
6. **No new student pushes or emails.** Drafts are for mentors only; students never see them.
7. **Database:** never run anything against Supabase. Schema changes go into the one new idempotent patch file owned by WS-2.
8. **UI:** system fonts only, and red only for the sidebar's selected state. No outlined cards everywhere, pill clutter, emoji, glows or hover-lift. Copy is short, plain Chinese.
9. **Quality bar:** `npx jest -w 3` and `npm run build` pass, and new logic gets tests. UI workstreams check `/mentor` in the harness (`npx vite --config vite.harness.config.js`, port 5199; add `?role=2` to see a normal mentor).
10. **Save tokens:** read only the files you own plus the contracts below. `src/pages/Mentor.jsx` is about 2,400 lines; only WS-6 opens it, and it should read it in ranges.

---

## Part 1 · What the AI can and cannot know (applies to WS-1 and WS-2)

The model never sees a student's actual work: no homework, essays, problems, notes pages or tests. Its only evidence is what the student typed into each `learning_sessions` row:

| Field | Example | What it lets us say |
|---|---|---|
| date and start/end time | 10/25 周日 19:10–19:50 | when they studied (rarely worth mentioning) |
| course / chapter / unit names | 物理 · 牛顿定律 · 斜面 | **what** they worked on, the main anchor for specificity |
| category | 学习 / 复习 / 练习 | **what kind** of work, and sequences across days |
| form | 网课 / 自学 … | rarely useful |
| duration | 40 分钟 | may be stated as a fact, never judged as long or short |
| 主观 self_rating | 基本掌握 | the student's own feeling, **never proof of mastery** |
| 客观 grade_label (练习 only) | B+ | the only outside measure; report it neutrally |
| notes | 「斜面那题受力图错两次，对着例题改了」 | the only window into what actually happened; quote it, don't embellish |

Exam scores (`exam_scores`) may be used by WS-2 as facts, with the same rules as grades.

### 1.1 Grounding rules

**May say:**
- names, types, dates and durations from the records
- grades as written
- the student's own note wording, quoted in 「」
- anything listed in the code-computed 「概况」 (§1.2)

**Must not say:**
- **Quality of the work:** 写得清楚, 思路对了, 结构好多了.
- **Understanding:** 弄懂了, 掌握了, 学会了. The self-rating is only the student's feeling.
- **Effort or character:** 认真, 用心, 努力, 态度.
- **Actions or amounts not in a note:** 做了 20 道题, 改了三遍, 背熟了, 自己改过来的 (when the note only says 改了).
- **Causes:** 因为复习了所以实测提高了.
- **Predictions:** 下次就不会错了, 肯定没问题.

**Not too optimistic:**
- No 进步很大, 很稳, 扎实.
- A grade of B- or lower is never framed as good news.
- If the self-rating is high but the grade is low, that is a question for the weekly summary, not praise.

**Specific, but not more specific than the data:**
- Every message should be traceable to a record: subject + chapter + type + one detail (a grade, a note phrase or a sequence).
- **Thin data means a short message.** One record and no note gives one plain sentence about what was recorded, with no evaluation.

**Not open-ended:**
- At most one question per message.
- It must be about one concrete thing and answerable in one line (「摩擦力最后两题是卡在受力分析还是公式？」).
- Never 「有什么困难吗」「感觉怎么样」「有什么想法」.

**See the bigger picture:**
- The model first reads 「概况」, a set of patterns that code computes across the period and the weeks before it.
- It picks the **one** thing that best describes the period, usually a pattern rather than a single record. It falls back to a single record only when there is no pattern.

### 1.2 「概况」: facts computed by code, never by the model

WS-1 builds these in a pure module. Each fact is one short Chinese line that can be checked against the records. There are at most 6, most useful first.

| Fact | Rule | Example line |
|---|---|---|
| Count | period records by course | 昨天记了 3 条：物理 2 条、数学 1 条 / 上周有 4 天有记录，共 9 条 |
| Chain | same course+chapter has ≥2 different categories within 7 days, in time order | 物理 · 牛顿定律：10/24 学习，10/25 复习，10/25 练习 |
| Revisit | same chapter (or unit) on ≥3 different days within 14 days | 数学 · 导数 这两周记了 4 天 |
| Grade trend | same course, ≥2 graded practices in context+period: first and last | 物理练习实测：10/18 B-，10/25 B+ |
| New subject | course in the period but not in the previous 30 days | 第一次记化学 |
| Notes | how many period records have notes (only if ≥1) | 3 条里有 2 条写了备注 |
| 首月 progress | 首月 only: days with records since signup | 注册第 13 天，有记录的天数 10 天 |
| Usual rhythm | reminders only: average recorded days per week over the previous 3 weeks | 之前一般每周记 4–5 天 |
| Last record | reminders only: the last record as a full line | 最后一条：10/23 英语 · 词汇 · 复习 · 备注「…」 |

Facts never contain adjectives. They also become the 「依据」 the mentor sees under the card (`meta.facts`).

### 1.3 Grounding check after generation (code, WS-1)

`checkGrounding(text, input)` returns a list of problems:

- **Grades:** every grade token in the text (`/(?<![A-Za-z])([A-DF][+-]?)(?![A-Za-z])/`) must appear in the input records or facts.
- **Numbers:** every Arabic number must appear somewhere in the input text (records + facts). Numbers inside dates count.
- **Quotes:** every 「…」 segment must be a substring of some record's notes.
- **Judgement words:** 认真, 用心, 努力, 扎实, 很稳, 稳, 清楚多了, 掌握了, 弄懂了, 懂了, 理解了, 学会了, 进步, 肯定, 一定能, 下次就不会.
  - These are added to the existing `STOCK` list, so `lintDraft` still applies.
  - 稳 and 懂了 are matched as whole phrases, so they don't hit 稳定 / 懂得.
- **Reminders also must not contain:**
  - `/\d+\s*天(没|没有)(记|填)/`
  - 记得填, 请, 及时, 务必, 打卡
  - two or more questions

If there are problems, retry once with them appended, as `generateDraft` already does for lint. If problems remain:
- keep the draft
- store them in `meta.lint`
- the card then shows one muted warning line: 「这条可能有和记录对不上的地方，发之前看一眼」

---

## Part 2 · Contracts between workstreams

### C1 · `supervision_drafts` after the v2 patch

```
kind        'daily' | 'weekly' | 'nudge'                         -- nudge is new
status      'draft' | 'sent' | 'snoozed' | 'skipped' | 'dropped' -- snoozed and dropped are new
snooze_until date null                                            -- set with status 'snoozed'
skip_reason  text null                                            -- 当面说过了 / 请假了 / 这条写得不合适
meta         jsonb not null default '{}'
```

The other columns are unchanged. Shape of `meta` (every key optional):

```js
{
  nudge: true,                 // weekly that also carries a reminder → 「周小结 + 提醒」
  why: '昨天记了 2 条：物理、数学', // short reason shown top-right of the card (code-built)
  facts: ['…'],                // 「依据」 lines (code-built 概况 actually shown to the model)
  alts: ['…', '…'],            // up to 2 alternative wordings, already grounding-checked
  lint: ['…'],                 // problems left after the retry (§1.3)
  system_push_date: '2026-10-25', // an inactive push reached the student yesterday or today
  recommend_snooze: 3,         // UI marks this option 「建议」
  from_snooze: true,           // regenerated after 过几天再说
  drop_reason: '学生已经记了',   // status 'dropped'
}
```

**Invariant: a student has at most one `status = 'draft'` row.** When a new draft is created, any older open draft for that student becomes `dropped` with `meta.drop_reason = '有了更新的一条'`.

### C2 · `generateDraft(input, env)` (WS-1 exports, WS-2 calls)

```js
input = {
  kind: 'daily' | 'weekly' | 'nudge',
  dayN: number | null,          // 注册第几天（首月才有）
  records: PromptRecord[],      // the period (daily: yesterday; weekly: last Mon–Sun; nudge: [])
  context: PromptRecord[],      // the 30 days before the period start (for 概况), oldest first
  issues: string[],             // weekly only (detectWeeklyIssues), unchanged
  combineNudge: boolean,        // weekly + 提醒 in one message
  nudge: null | { neverRecorded: boolean, phase: 'first-month' | 'weekly' },
  lastSent: null | { text: string, date: 'YYYY-MM-DD' }, // last message actually sent to this student
  styleRefs: [{ before: string, after: string }],        // ≤3 recent mentor edits for this student
  rejected: string[],           // ≤2 bodies skipped with reason 这条写得不合适
  avoidOpenings: string[],      // first ~8 chars of drafts already written in this run
  exams: [{ date, course, name, grade_label, score, notes }], // optional, within context window
}
// PromptRecord = toPromptRecord(row) plus chapter_id/unit_id/course_id kept for fact-building only.

returns {
  text: string,
  alts: string[],         // 0–2, each grounding-checked; failures dropped
  evidence: number[],     // 1-based indexes into [...records, ...context] in prompt order
  facts: string[],        // the 概况 lines sent to the model
  why: string,            // card reason line (code-built, see §WS-1)
  lint: string[],
}
```

### C3 · `useDrafts()` return value (WS-3 exports, WS-4/5/6 use)

```js
{
  status,            // idle | loading | ready | unavailable | error (unchanged meaning)
  drafts,            // open drafts + rows handled today (sent/snoozed/skipped today) for the visible students
  sessionById, busy, errors,
  handlerName(id),   // profiles.full_name of handled_by ('你' when it is the current user)
  copyAndSend(draft, fallbackEl) → 'copied' | 'selected' | 'failed'  // copyText + status sent
  undo(draft),                    // back to 'draft', clears handled_by/at, snooze_until, skip_reason
  saveEdit(draft, text),          // unchanged
  snooze(draft, days),            // days ∈ SNOOZE_DAYS; status 'snoozed', snooze_until = today + days
  skip(draft),                    // status 'skipped'
  setSkipReason(draft, reason),   // reason ∈ SKIP_REASONS or null
  nextAlt(draft) → string|null,   // cycles meta.alts locally (writes edited_body); null when exhausted
  regenerate(draft),              // unchanged API call (used when alts are exhausted)
  loadHistory(studentId) → Promise<Draft[]>, // last 30 days, all statuses except 'draft' and 'dropped'
  reload,
}
```

Constants go in `src/lib/supervision.js` (WS-2 owns the file and adds them first thing; WS-3 imports them):

```js
export const SNOOZE_DAYS = [3, 5, 7];
export const NUDGE_MIN_INTERVAL_DAYS = 3;
export const NUDGE_GAP_FIRST_MONTH = 2;   // 首月：gap = 今天 − 最后记录日；2 = 昨天没记
export const NUDGE_GAP_WEEKLY = 3;        // = GAP_ALERT_DAYS
export const NUDGE_NEVER_FROM_DAY = 3;    // 首月从没记过：注册第 3 天起
export const SKIP_REASONS = ['当面说过了', '请假了', '这条写得不合适'];
```

### C4 · Component props (WS-4/WS-5 export, WS-6 wires)

```jsx
<MessageCard
  draft person={{ id, name, stageText, school, consultant, mentorName }}
  variant="queue" | "detail"    // detail: no avatar/name row, text starts at the left edge
  showMentor={isAdmin}
  dr={useDraftsResult}          // calls dr.* directly
  todayIso onOpenStudent={(id) => …}
/>
<MessageQueue drafts persons dr todayIso showMentor onOpenStudent />  // the 「待发」 panel incl. empty states
<WeekBoard rows showMentor onOpenStudent onJumpToDraft />           // 「这周谁记了」
<StudentPage
  student person draft dr todayIso showMentor
  sessions sessionsTruncated fillDates   // Set of 'YYYY-MM-DD' with records (≥28 days back)
  backLabel onBack onPrev onNext          // J / K keep working on this page
  onEditAlias onDisconnect onOpenAnalytics
/>
```

`WeekBoard` rows: `{ id, name, stageText, school, mentorName, days: [{ date, state: 'f'|'e'|'t'|'n' }] (7, oldest first), stateText, warn, subText, lastText, draft }`.
- State codes: `f` = recorded; `e` = empty; `t` = today, not recorded yet; `n` = before signup.
- Grouping is 要跟进 (`warn`) first, then 正常.

---

## WS-1 · AI evidence, facts and prompt

**Owns:**
- `api-lib/supervision-prompt.mjs`
- new `api-lib/supervision-facts.mjs`
- `__tests__/supervisionPrompt.test.js`
- new `__tests__/supervisionFacts.test.js`
- `scripts/supervision-dry-run.mjs`

**Risk:** high for message quality. Give the result a careful review.

1. **`supervision-facts.mjs`** (pure): `buildFacts({ kind, records, context, dayN, nudge, exams, today })` returns `{ why, facts }`, using the exact rules in §1.2.
   - `why` strings:
     - daily: `昨天记了 N 条：物理、数学`
     - weekly: `上周记了 X 天`, plus ` · 有一件事可以问问` when there are issues
     - combined: `上周记了 X 天 · 之后 N 天没记`
     - nudge: `首月 · N 天没记`, `N 天没记` or `首月第 N 天 · 还没记过`
   - `why` is for the mentor only, so it may contain day counts. Facts may not, except the 首月 progress line.
2. **Prompt rewrite in `supervision-prompt.mjs`.** Keep `VOICE` and its banned-word list, but replace every 「新生」 with 首月. Add these blocks, verbatim or closer:

   ```
   EVIDENCE（所有任务共用）
   你能看到的只有学生自己填的记录：日期、时间、科目/章节/单元、类型（学习/复习/练习）、时长、主观自评、练习的实测等第、备注。你看不到他的作业、题目、笔记和试卷本身。
   - 能说的：记录里写着的科目、章节、类型、日期、时长、实测等第，备注里的原话（用「」引），以及「概况」里的事实。
   - 不能说的：作业或文章写得怎么样、思路对不对、懂没懂、掌握没掌握；认不认真、用不用心；备注里没写的动作和数量（做了几道题、改了几遍、背熟了）；两件事之间的因果；对以后的预测。
   - 自评只是学生自己的感觉，不能当成掌握了来夸。实测 B- 或更低时不要当成好消息说。
   - 不要比记录更乐观：不说「进步很大」「很稳」「扎实」「肯定没问题」。
   - 要具体到能对上一条记录，但不要编出比记录更细的细节。记录少、没有备注时就少说，一句话说清他记了什么。
   看全局：
   - 先读「概况」，挑一件最能说明这段时间的事来说，通常是一个规律（同一章学了又复习、隔几天又回来做、同一科实测有变化、第一次记某一科），而不是随便挑一条记录。概况里没有明显规律时，才说某一条记录。
   - 只说一两件事，不要罗列。
   提问：
   - 最多问一个问题，针对一件具体的事，学生一句话就能回答。不要问「有什么困难吗」「感觉怎么样」「有什么想法」这种空问题。

   NUDGE_TASK
   任务：学生最近几天没有记录，写一条轻轻的提醒。
   - 开头不要说他几天没记、没填。先接上他最后一次记录里的一件具体的事；从没记过的学生，按「可能还不会用」来写，不按「偷懒」来写。
   - 不说天数，不说「记得填写」「请」「及时」「务必」「打卡」，不用感叹号，不要让人觉得被催。
   - 可以轻轻猜一句他可能在忙（「这两天是不是作业多？」），只猜一次，不追问原因。
   - 结尾给一个很小的下一步：「记一条就行」「先记今天上的一节课」。
   - 两到三句话，30 到 70 个字。
   - 不要和「上次发给他的消息」用同一个开头或同一个话头。

   COMBINED（weekly + combineNudge）
   在周小结的第二部分写提醒（规则同 NUDGE_TASK），代替「要提的问题」；有问题时只挑最要紧的一件，和提醒合成一句。
   ```

   - **User message order:** 概况 → 记录 (numbered `#1…`, period first, then context marked 「之前」) → 要提的问题 → 上次发给他的消息 → 导师之前改过的样子 (before → after, "learn the tone only") → 不合适的写法 (rejected) → 今天已经用过的开头.
   - **Output JSON:** `{"text":"…","alts":["…","…"],"evidence":[1,3]}`. The alts must differ in angle, not just wording. Daily ≤60 characters, weekly ≤120, nudge ≤70.
   - **Replace `EXAMPLES`** with the corrected samples in `design.html`. Those were rewritten to follow §1.1, e.g. 「斜面那题受力图错了两次，你备注里写了是对着例题改的。牛顿第二定律那节当天也复习了。」 Keep the 「不要写成这样」 pair, and add an overclaiming bad example: 「议论文结构清楚多了，看得出你很用心。」
3. **`checkGrounding`** as in §1.3. It is called inside `generateDraft` on `text` and on each alt. Keep the existing retry flow: one retry that lists both lint and grounding problems.
4. **`generateDraft`** returns C2's shape. Keep the weekly-without-issues trimming, but not when `combineNudge` is set.
5. **Tests:**
   - `buildFacts`: one test per fact type.
   - Edge cases: no chapter, ungraded practice, N/A grade, records with no notes.
   - `checkGrounding`:
     - invented grade, invented number, invented quote, judgement word
     - reminder day count, two questions
     - clean text passes
   - `buildMessages` places the blocks in order and never contains 新生.
   - `generateDraft` with a mocked fetch: alts filtered, lint kept, `combineNudge` keeps the second paragraph.
6. **`scripts/supervision-dry-run.mjs`:** add `--kind nudge` and print facts, text, alts and lint side by side, so the user can eyeball output against real data before deploying.

## WS-2 · Job, data model, API

**Owns:**
- `api-lib/supervision.mjs`
- `api/supervision/index.js`
- `src/lib/supervision.js`
- new `supabase/schema.patch-supervision-v2.sql`
- `__tests__/supervisionJob.test.js`, `__tests__/supervisionJobHandler.test.js`, `__tests__/supervision.test.js`

**Risk:** high, because this touches the production table and runs every 15 minutes.

1. **Constants (C3) in `src/lib/supervision.js` first.** Commit them alone, so WS-3 can build on that commit. In comments and doc text, 新生 becomes 首月; the `'new-missed-yesterday'` key may stay.
2. **SQL patch** (idempotent, comments in Chinese like the v1 patch):
   - Drop and re-add the `kind` and `status` check constraints with the new values. Look the constraint names up via `pg_constraint` in a `DO` block, because v1 used inline checks.
   - Add columns `snooze_until date`, `skip_reason text`, `meta jsonb not null default '{}'`.
   - Add `create index if not exists supervision_drafts_student_created on supervision_drafts (student_id, created_at desc)`.
   - Widen the column grant to `grant update (edited_body, status, handled_by, handled_at, snooze_until, skip_reason) … to authenticated`. `meta` stays server-only.
   - Add a check that `status = 'snoozed'` implies `snooze_until is not null`.
   - Existing rows stay valid.
3. **Store additions** in `createSupabaseStore`:
   - `listOpenDrafts(studentIds)`
   - `listDueSnoozed(today)`
   - `lastNudgeSentAt(studentIds)`: the latest `handled_at` where (`kind = 'nudge'` or `meta->>nudge = 'true'`) and `status in ('sent','snoozed')`
   - `lastSent(studentId)`
   - `styleRefs(studentId)`
   - `rejected(studentId)`
   - `recentInactivePush(studentIds, sinceDate)`: `push_deliveries`, `kind = 'inactive'`
   - `loadExams(studentIds, from, to)`
   - `dropDrafts(ids, reason)`
4. **Job order inside `runSupervisionJob`.** Each step respects the existing cap, budget and failure stop.
   1. **Auto-drop.** An open or snoozed `nudge` (or a weekly with `meta.nudge`) for a student who has a record dated after the draft's `created_at` date becomes `dropped` with reason `学生已经记了`.
   2. **Snooze returns.** For rows with `status = 'snoozed'` and `snooze_until <= today`, regenerate in place:
      - kind = what the student needs today: praise of records since `period_end`, or a reminder if there are still none
      - `meta.from_snooze = true`, status back to `draft`, `period_end = yesterday` (or today for a nudge), `edited_body = null`
      - Keep `period_start`, so the unique key stays stable.
      - If the kind would change (daily → nudge), mark the old row `dropped` with reason `有了更新的一条` and insert a new row instead.
   3. **Weekly** (Monday, weekly-phase students), as today, with one change:
      - If the student's current gap is ≥ `NUDGE_GAP_WEEKLY` and the 3-day interval allows it, set `combineNudge` and `meta.nudge = true`.
      - A weekly-phase student with no records last week but a gap ≥ 3 is handled by the nudge step instead.
   4. **Daily praise:** 首月 day ≥2 with records yesterday. Unchanged.
   5. **Nudges.** A connected student qualifies if they have no open draft from steps 2–4 today and either:
      - **首月:** day ≥2 and gap ≥ `NUDGE_GAP_FIRST_MONTH`, or never recorded and day ≥ `NUDGE_NEVER_FROM_DAY`
      - **Weekly phase:** gap ≥ `NUDGE_GAP_WEEKLY` (never recorded counts)

      Skip the student if a reminder was sent or snoozed within `NUDGE_MIN_INTERVAL_DAYS`. Otherwise:
      - `period_start = period_end = today`
      - `records = []`, `context` = last 30 days
      - If `recentInactivePush` finds a push dated yesterday or today, set `meta.system_push_date` and `meta.recommend_snooze = 3`.
   6. **Every insert** applies the C1 invariant (drop older open drafts for that student) and stores `meta.{why, facts, alts, lint}` from C2.
   7. Pass `avoidOpenings` between drafts in the same run.
5. **`regenerateDraft`** handles `nudge` (context = last 30 days up to today) and the combined weekly. It clears `meta.alts` and refills them.
6. **`api/supervision/index.js`:** no new actions are expected. Confirm that `regenerate` accepts the new kinds and that `requireMentor` still guards it.
7. **Tests:**
   - each job step on the in-memory store, including the invariant
   - the 3-day interval
   - auto-drop
   - a snooze return that keeps the kind and one that changes it
   - the Monday combine
   - the push note
   - quiet hours and the cap unchanged
   - a SQL patch lint test if `supervision.test.js` already parses SQL; otherwise skip

**Hand-off to the user:** list the exact order to run `schema.patch-supervision-v2.sql`. It must run before deploying any client code from WS-3 to WS-6, because the client writes `snooze_until` and `skip_reason`.

## WS-3 · Client data hook and wording

**Owns:**
- `src/components/mentor/useDrafts.js`, `fillInfo.js`, `FillStrip.jsx`, `StudentTable.jsx`, `StudentCards.jsx`
- `__tests__/mentorFillInfo.test.js`

**Risk:** medium.

1. **`useDrafts`** returns C3's shape.
   - **Queries:** open drafts, plus rows with `handled_at >= startOfToday` and status in `sent`, `snoozed`, `skipped`. Add `snooze_until, skip_reason, meta` to `COLS`.
   - **`handlerName`:** fetch `profiles(id, full_name)` once for the distinct `handled_by` values (mentors can read all profiles under `profiles_select_self_or_mentor`).
   - **Optimistic updates** with rollback on error, as `markSent` does today.
   - **`undo`** writes `status 'draft', handled_by null, handled_at null, snooze_until null, skip_reason null`.
   - **If the v2 columns are missing** (PostgREST 42703 / PGRST204), set `status = 'unavailable'` instead of crashing, as `isMissingTable` does now.
2. **Wording:**
   - every user-facing 新生 becomes 首月; `stage` becomes `首月 · 第 ${day} 天` or `每周看`
   - `draftKindLabel` returns 每日表扬 / 周小结 / 周小结 + 提醒 / 提醒
   - comments in these files follow the same rule
3. **`fillInfo`** gains `weekBoardRow(student, info, draft, today)`, which builds a C4 `WeekBoard` row (stateText 每天都记 / 正常 / N 天没记 / 还没开始记; warn when the student is on the attention list). Test it.
4. **`StudentTable`** is the 全部学生 tab's table:
   - grouped by 顾问
   - columns 学生 (with 本名 under it only when the alias differs), 学校, 阶段, 近 7 天, 最后一次记录, 连接
   - an extra 导师 column for admins
   - existing row actions (断开 / 改备注 / 邀请) stay
   - drop the 需关注 and 待补填 columns and the red counts in group headers
   - use the WS-4 tokens for contrast (14px body, `#1C1C1E` / `#48484A` / `#6E6E73`)

   Keep `StudentCards` (mobile) in sync on wording only.

## WS-4 · 今天 tab components

**Owns:**
- new `src/components/mentor/MessageCard.jsx`, `MessageQueue.jsx`, `WeekBoard.jsx`
- new `src/styles/mentor-desk.css` (prefix `md-`)
- new `__tests__/mentorMessageCard.test.jsx`

**Risk:** medium.

1. Build from `design.html` (classes there are a guide, not a contract). The card has:
   - avatar, name (a link to the student page), meta line, and why top-right: kind label in green for praise, amber for reminders
   - the message bubble
   - the `meta.system_push_date` note in amber
   - `依据` toggle showing `meta.facts` plus the evidence records
   - the `meta.lint` warning line
   - actions: **复制** (primary) · 改一下 · 过几天再说 (menu: 3 / 5 / 7 天后 with dates, `recommend_snooze` marked 建议, label 「到时候按最新的记录重新写一条」) · 不用发 · 换个说法 (`dr.nextAlt`, then `dr.regenerate` once alts run out)
2. **Collapsed rows** after an action:
   - **sent:** 已复制给 X，记为已发 · 撤销; when someone else sent it: 「李老师 09:12 已发给 X」 with no undo
   - **snoozed:** 「X：10/29 周四 按那时的记录重新写一条」 · 撤销
   - **skipped:** reason buttons (`SKIP_REASONS`) · 撤销
3. **`WeekBoard`** matches the mock: weekday header with 今 in bold, 18px day squares, 情况 in plain words, and a 今天的消息 column that scrolls to and flashes the card.
4. **CSS:**
   - all values live in `mentor-desk.css`, scoped under `.md-root`
   - no changes to `src/index.css`
   - the `--md-*` contrast tokens are defined on `.md-root`
   - phone width: no horizontal page scroll (tables scroll inside their panel)
5. Write the tests with a stubbed `dr`: each action calls the right method, the collapsed states render, the 建议 marker shows, and the lint line shows.

## WS-5 · Student page

**Owns:**
- new `src/components/mentor/StudentPage.jsx`
- new `src/styles/mentor-student-page.css` (prefix `sp-`)
- new `__tests__/mentorStudentPage.test.jsx`

**Risk:** medium. It imports `MessageCard` from WS-4. Code against C4; if WS-4 isn't merged yet, stub the import in your test.

1. **Layout as in the mock:**
   - back link (`backLabel`)
   - header: name, then 首月/每周看 · 学校 · 顾问 · (导师, admin only) · 连接状态, and 改备注 / 断开连接 on the right
   - **left column:**
     - 今天的消息: a `MessageCard` with `variant="detail"`, or 「今天没有要发的消息。」
     - 最近的记录: reuse `SheetRecordRow` for each row; keep the existing 2000-row truncation note; link 在数据分析里看 → `onOpenAnalytics`
   - **right column:**
     - 四周填写: a Monday-first 4-week calendar from `fillDates`, with today striped and days before signup blank
     - 发过的消息: from `dr.loadHistory(id)`, showing date · kind · who · status and the text; skipped rows show the reason. Under the list: 「上次提醒：…。同一个学生两次提醒至少隔 3 天。」
   - collapses to one column under 1100px
2. **J / K** call `onPrev` / `onNext` (ignored while typing). **Esc** calls `onBack`.
3. Write the tests: render with and without a draft, history list states, and keyboard handlers.

## WS-6 · Integration in `Mentor.jsx` + harness

**Owns:**
- `src/pages/Mentor.jsx`, `src/components/mentor/TodayFeedback.jsx` (delete), `__tests__/mentorTracker.test.jsx`, `__tests__/mentorR4.test.jsx`
- `.harness/mentorData.js`, `scripts/harness-supervision-plugin.mjs`

**Risk:** high, because of the size of the file. Starts **after WS-3, WS-4 and WS-5 are merged**.

1. **In-page tabs inside `activeView === 'students'`,** on desktop and the mobile branch:
   - 今天 (count of open drafts) | 全部学生 (count)
   - right side: the existing 顾问 filter (`filterConsultant`) as one select shared by both tabs, plus search
   - the tab lives in the URL (`?tab=today|all`, default `today`), so reload and back work
2. **今天 tab:** page header (date, 「今天有 N 条消息要发」 or 「今天的消息都处理完了」, one-line subline), then `MessageQueue`, then `WeekBoard` with the footer link to 全部学生.
   - Remove `TodayFeedback`, its `T` shortcut and its collapsed strip.
   - Keep J/K and `/` on the list.
3. **全部学生 tab:**
   - the existing list (`StudentTable` from WS-3) with the 学校 / 连接 filters and 邀请学生
   - the 列表 / 卡片 toggle stays
   - move the school/connection filters off the 今天 tab
4. **Student page:**
   - `?student=<id>` (already parsed at `Mentor.jsx:973`) now renders `StudentPage` in place of the tab content, instead of opening the Sheet
   - back goes to the tab in `?tab`
   - move the alias editing, disconnect and records loading that currently live in the Sheet block (~lines 1203–1340) into props and callbacks
   - delete the desktop Sheet usage
   - on mobile, `StudentPage` replaces the current detail view as a full screen
5. **Admin:** pass `showMentor = isAdmin`. The mentor name for each student comes from the connection's `teacher_id`. Admins see every action, per decision 4.
6. **Wording:** 新生 → 首月 everywhere in `Mentor.jsx`, including the hints line (`Mentor.jsx:1199`, which becomes 「首月 = 注册 30 天内，每天看；之后每周看」) and the `newMissed` detail at `:938`.
7. **Harness data:**
   - drafts for each case: daily, weekly, nudge, combined, one with `system_push_date` + `recommend_snooze`, one with `meta.lint`, one sent today by 李老师 (`handled_by: 't-2'`)
   - `meta.why`, `meta.facts` and `meta.alts` filled, with sample texts copied from `design.html`
   - a 李老师 connection for one student, so `?role=3` shows the 导师 column
   - plugin endpoints return the new fields
8. **Tests:** update `mentorTracker.test.jsx` (the 今日反馈 describe block becomes 今天 tab tests, and the Sheet tests become StudentPage-route tests). Keep the alias/delete tests green.
9. **Harness check:**
   - `/mentor` as admin and with `?role=2`, desktop and 375px wide
   - the four card actions, and undo for each
   - 换个说法
   - opening a student from the card name, the board row and the 全部学生 table; back returns to the right tab
   - J/K on the student page
   - `/e4` is unchanged

---

## Order of work

| Wave | Workstreams | Notes |
|---|---|---|
| 1 | **WS-1**, **WS-2**, **WS-4**, **WS-5** in parallel | WS-2 commits the C3 constants first (one small commit). WS-4/WS-5 code against C3/C4 with a stub `dr`. |
| 1b | **WS-3** | Starts from WS-2's constants commit; parallel with the rest of wave 1. |
| 2 | **WS-6** | After WS-3, WS-4 and WS-5 are merged into the integration branch. |
| 3 | Review | The user (or Claude) reviews WS-1's prompt output with `scripts/supervision-dry-run.mjs` on real data, then runs the SQL patch, then deploys. |

No two workstreams edit the same file. WS-1 and WS-2 meet only through C2: WS-2 calls `generateDraft`, and its tests inject a fake `generate`, so it never needs WS-1's code to pass.

**Suggested models:**
- WS-1 and WS-2: the strongest available model, or at least a careful review of the diff (prompt quality and production SQL).
- WS-6: the strongest model, because of the large file and many call sites.
- WS-3, WS-4, WS-5: flash models are fine.

## Open questions (defaults used if nobody answers)

1. **When the first reminder is drafted.** Default: 首月 after 2 empty days (yesterday and the day before), weekly-phase after 3, and a 首月 student who never recorded from day 3. These are the constants in C3.
2. **Clashes with the system's inactive push.** The system already sends an inactive push at 3 and 7 empty days. Default: keep it and only show the note on the card. Alternative, not in this plan: skip the system's push for students whose mentor sent a reminder in the last 3 days (a change to `api-lib/notify.mjs`; fewer pushes to students).
3. **J / K on the student page:** kept by default.
4. **Cost:** reminders add roughly 30–50% more model calls per night. Asking for 2 alternatives in the same call keeps 「换个说法」 free in most cases.
