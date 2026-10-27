// AI 监督流程的服务端：数据访问（service role）+ 定时任务 + 单条重新生成。
// 只在服务端使用（api/supervision/index.js），绝不进入前端 bundle。
//
// 草稿只给导师看；一个学生同一时间最多一条 status = 'draft'（新草稿出现时旧的会被撤下 dropped）：
//   daily  首月（第 2–30 天）昨天有记录 → 一句表扬（period = 昨天）
//   weekly 首月之后，每周一对上一个完整周（周一到周日）生成一段小结
//          「要提的问题」由本文件用代码判定（detectWeeklyIssues），模型不自己找问题
//          学生同时已经好几天没记的话，周小结里顺带提醒（combineNudge，meta.nudge）
//   nudge  温和提醒：首月昨天没记 / 首月从没记过 / 首月之后连续几天没记（门槛见 src/lib/supervision.js）
// 一次运行的顺序：撤下过期提醒 → 「过几天再说」到期的重写 → 周小结 → 每日表扬 → 提醒。
// 给模型的记录只有课程 / 章节 / 单元名称，不含学生姓名。
import {
  addDays, dayNumber, daysBetween, fillSummary, lastWeekRange, phaseOf, shanghaiToday,
  NEW_STUDENT_DAYS, NUDGE_GAP_FIRST_MONTH, NUDGE_GAP_WEEKLY, NUDGE_MIN_INTERVAL_DAYS, NUDGE_NEVER_FROM_DAY,
  SKIP_REASONS,
} from '../src/lib/supervision.js';
import { generateDraft as defaultGenerate, modelNameOf } from './supervision-prompt.mjs';

export const MAX_DRAFTS_PER_RUN = 15;
export const RUN_BUDGET_MS = 28 * 1000; // 最坏一份草稿 3 次模型请求 × 10 秒，须在 60 秒函数上限内收尾
export const QUIET_FROM_HOUR = 23; // 上海时间 23:00 起不跑
export const QUIET_TO_HOUR = 6; // 到 06:00 为止不跑
export const MAX_RECORDS_PER_DRAFT = 60;
export const MAX_CONTEXT_RECORDS = 200; // 「概况」用的前 30 天记录上限（只保留最近的）
export const CONTEXT_DAYS = 30; // 概况窗口：本期开始之前 30 天
export const PREV_WEEKS_LOOKBACK = 3;
export const MAX_ISSUES = 4;
export const DROP_SUPERSEDED = '有了更新的一条';
export const DROP_RECORDED = '学生已经记了';
export const DROP_MUTED = '已隐藏 / 暂停';
const REJECTED_REASON = SKIP_REASONS[2]; // 这条写得不合适
const SNOOZE_RECOMMEND = 3; // 系统刚推送过：建议先推迟 3 天

const IN_CHUNK = 80;
const PAGE = 1000;
const WEEKDAY = '日一二三四五六';
// 客观评价由低到高；B- 及以下 = 下标 ≤ 7
const GRADES = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+'];
const B_MINUS = GRADES.indexOf('B-');

// ---------------------------------------------------------------------------
// 时间
// ---------------------------------------------------------------------------

export function shanghaiHour(now = new Date()) {
  return new Date(new Date(now).getTime() + 8 * 3600 * 1000).getUTCHours();
}

export function inQuietHours(now = new Date()) {
  const h = shanghaiHour(now);
  return h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR;
}

/** 上海时间的星期几：1 = 周一 … 7 = 周日 */
export function isoWeekday(iso) {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const weekdayName = (iso) => `周${WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;
const mmdd = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ---------------------------------------------------------------------------
// 周报「要提的问题」：全部用代码判定，返回短句数组（没有则 []）
// ---------------------------------------------------------------------------

/**
 * @param {Array} records 学生最近几周的记录（含上周与之前 3 周），字段：session_date, category, course_id, course,
 *   self_rating, grade_label
 * @param {{start: string, end: string}} week 要总结的那一周（周一到周日）
 */
export function detectWeeklyIssues(records, week) {
  const inWeek = (r) => r.session_date >= week.start && r.session_date <= week.end;
  const thisWeek = records.filter(inWeek);
  const prevStart = addDays(week.start, -7 * PREV_WEEKS_LOOKBACK);
  const prev = records.filter((r) => r.session_date >= prevStart && r.session_date < week.start);
  const courseKey = (r) => r.course_id || r.course || '';
  const out = [];

  // 1) 连续 ≥ 3 天没有记录（只看这一周内部）
  const filledDays = new Set(thisWeek.map((r) => r.session_date));
  let run = [];
  const flush = () => {
    if (run.length >= 3) {
      const a = run[0];
      const b = run[run.length - 1];
      out.push(`${weekdayName(a)}到${weekdayName(b)}（${mmdd(a)}–${mmdd(b)}）连续 ${run.length} 天没有记录`);
    }
    run = [];
  };
  for (let d = week.start; d <= week.end; d = addDays(d, 1)) {
    if (filledDays.has(d)) flush();
    else run.push(d);
  }
  flush();

  // 2) 之前 3 周有记录、这一周一条都没有的课程
  const thisCourses = new Set(thisWeek.map(courseKey));
  const dropped = new Map();
  for (const r of prev) {
    const k = courseKey(r);
    if (k && !thisCourses.has(k) && !dropped.has(k)) dropped.set(k, r.course || '这门课');
  }
  for (const name of dropped.values()) out.push(`${name}前三周都有记录，上周一条都没有`);

  // 3) 练习的实测还没填（按课程数）
  const emptyBy = new Map();
  for (const r of thisWeek) {
    if (Number(r.category) === 3 && !r.grade_label) {
      const k = courseKey(r);
      const cur = emptyBy.get(k) || { name: r.course || '练习', n: 0 };
      cur.n += 1;
      emptyBy.set(k, cur);
    }
  }
  for (const { name, n } of emptyBy.values()) out.push(`${name}有 ${n} 次练习的实测还没填`);

  // 4) 自评 ≥ 80（基本掌握 / 完全掌握）但同一门课的实测 B- 及以下
  const overBy = new Map();
  for (const r of thisWeek) {
    if (Number(r.category) !== 3 || !(Number(r.self_rating) >= 80)) continue;
    const gi = GRADES.indexOf(r.grade_label);
    if (gi < 0 || gi > B_MINUS) continue;
    const k = courseKey(r);
    const cur = overBy.get(k) || { name: r.course || '练习', grades: [] };
    cur.grades.push(r.grade_label);
    overBy.set(k, cur);
  }
  for (const { name, grades } of overBy.values()) {
    out.push(`${name}有 ${grades.length} 次练习自评是基本掌握以上，实测只有 ${grades.join('、')}`);
  }

  return out.slice(0, MAX_ISSUES);
}

// ---------------------------------------------------------------------------
// 记录 → 给模型看的形状
// ---------------------------------------------------------------------------

const byTime = (a, b) =>
  `${a.session_date} ${a.start_time || ''}`.localeCompare(`${b.session_date} ${b.start_time || ''}`);

/** 取 [from, to] 内的记录，按时间排序，最多 limit 条（保留最近的）。 */
export function recordsInRange(records, from, to, limit = MAX_RECORDS_PER_DRAFT) {
  const list = records.filter((r) => r.session_date >= from && r.session_date <= to).sort(byTime);
  return list.length > limit ? list.slice(-limit) : list;
}

/** 提示词需要的字段（不含 id / 学生信息）。chapter_id / unit_id / course_id 只给代码拼「概况」用。 */
export function toPromptRecord(r) {
  return {
    session_date: r.session_date,
    start_time: r.start_time,
    end_time: r.end_time,
    course: r.course,
    chapter: r.chapter,
    unit: r.unit,
    course_id: r.course_id,
    chapter_id: r.chapter_id,
    unit_id: r.unit_id,
    category: r.category,
    form: r.form,
    duration_minutes: r.duration_minutes,
    self_rating: r.self_rating,
    grade_label: r.grade_label,
    notes: r.notes,
  };
}

/** 模型引用的 1 基序号 → 记录 id（去重，越界的丢掉）。 */
export function evidenceIds(indexes, records) {
  const ids = [];
  for (const n of indexes || []) {
    const rec = records[Number(n) - 1];
    if (rec?.id && !ids.includes(rec.id)) ids.push(rec.id);
  }
  return ids;
}

/** 某位学生某一期需要的记录范围（daily: 昨天；weekly: 上一整周；nudge: 今天） */
export function periodOf(kind, today) {
  if (kind === 'weekly') return lastWeekRange(today);
  if (kind === 'nudge') return { start: today, end: today };
  const y = addDays(today, -1);
  return { start: y, end: y };
}

const dateOf = (v) => String(v).slice(0, 10);
const shanghaiDateOf = (ts) => shanghaiToday(new Date(ts));
/** 提醒类草稿：nudge，或周小结里顺带提醒（meta.nudge） */
const isNudgeDraft = (d) => d.kind === 'nudge' || (d.kind === 'weekly' && d.meta?.nudge === true);
const openingOf = (text) => String(text || '').replace(/\s+/g, '').slice(0, 8);
const firstMonthDayN = (student, today) => {
  const n = dayNumber(student.created_at, today);
  return n != null && n >= 1 && n <= NEW_STUDENT_DAYS ? n : null;
};

/**
 * 提醒的输入：首月 / 每周两种口径；neverRecorded 只在首月能确定
 *（日期查询只看最近 30 天，首月学生的全部记录都在里面；首月之后的无法区分「从没记过」，一律 false）。
 */
export function nudgeInputOf(student, today, hasAnyRecord) {
  const first = phaseOf(student.created_at, today) === 'daily';
  return { neverRecorded: first && !hasAnyRecord, phase: first ? 'first-month' : 'weekly' };
}

/**
 * 为一位学生生成一份草稿内容（不写库）。
 * @param {object} p
 * @param {'daily'|'weekly'|'nudge'} p.kind
 * @param {{start: string, end: string}} p.period
 * @param {Array} p.records 已加载的记录：本期 + 本期之前至少 30 天
 * @param {boolean} [p.combineNudge] 周小结里顺带提醒
 * @param {object|null} [p.nudge] { neverRecorded, phase }
 * @returns {Promise<{ body, evidence, model, alts, facts, why, lint } | { empty: true }>}
 */
export async function composeDraft({
  kind, student, period, records, today, generate, env,
  combineNudge = false, nudge = null, lastSent = null, styleRefs = [], rejected = [], avoidOpenings = [], exams = [],
}) {
  const inPeriod = records.filter((r) => r.session_date >= period.start && r.session_date <= period.end);
  if (kind !== 'nudge' && inPeriod.length === 0) return { empty: true };
  const picked = kind === 'nudge' ? [] : recordsInRange(records, period.start, period.end);
  const context = recordsInRange(
    records, addDays(period.start, -CONTEXT_DAYS), addDays(period.start, -1), MAX_CONTEXT_RECORDS,
  );
  const input = {
    kind,
    today, // 上海日期 YYYY-MM-DD，生成「概况」里的断了几天用（C2 之外的补充字段）
    dayN: firstMonthDayN(student, today),
    records: picked.map(toPromptRecord),
    context: context.map(toPromptRecord),
    issues: kind === 'weekly' ? detectWeeklyIssues(records, period) : [],
    combineNudge: kind === 'weekly' && Boolean(combineNudge),
    nudge: kind === 'nudge' || combineNudge ? nudge : null,
    lastSent,
    styleRefs,
    rejected,
    avoidOpenings,
    exams,
  };
  const draft = await generate(input, env);
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    body: draft.text,
    // 模型引用的序号对应 [...records, ...context]（提示词里的顺序）
    evidence: evidenceIds(draft.evidence, [...picked, ...context]),
    model: modelNameOf(env),
    alts: list(draft.alts),
    facts: list(draft.facts),
    why: typeof draft.why === 'string' ? draft.why : '',
    lint: list(draft.lint),
  };
}

/** 这位学生的「上一条真正发出的消息 / 导师改过的写法 / 被否掉的稿 / 考试」，生成前一并取（取不到的项用默认值）。 */
export async function gatherExtras(store, studentId, from, to) {
  const [lastSent, styleRefs, rejected, exams] = await Promise.all([
    store.lastSent(studentId),
    store.styleRefs(studentId),
    store.rejected(studentId),
    store.loadExams([studentId], from, to),
  ]);
  return {
    lastSent: lastSent || null,
    styleRefs: styleRefs || [],
    rejected: rejected || [],
    exams: (exams || []).map(({ student_id: _omit, ...e }) => e),
  };
}

// ---------------------------------------------------------------------------
// 定时任务
// ---------------------------------------------------------------------------

/**
 * @param {object} p
 * @param {object} p.store createSupabaseStore() 或测试里的内存实现
 * @param {Function} [p.generate] generateDraft（可注入）
 * @param {object} [p.env]
 * @param {Date} [p.now]
 * @param {() => number} [p.clock] 毫秒时间戳（预算计时用，可注入）
 */
export async function runSupervisionJob({
  store, generate = defaultGenerate, env = process.env, now = new Date(), clock = Date.now,
  maxDrafts = MAX_DRAFTS_PER_RUN, budgetMs = RUN_BUDGET_MS,
}) {
  const summary = {
    created: 0, failed: 0, skipped: {}, daily: 0, weekly: 0, nudge: 0, returned: 0, dropped: 0,
  };
  if (inQuietHours(now)) return { ...summary, skipped: { quiet: true } };

  const today = shanghaiToday(now);
  const yesterday = addDays(today, -1);
  const startedAt = clock();
  const allStudents = await store.listScopeStudents();
  if (allStudents.length === 0) return summary;
  // 被隐藏 / 暂停的学生不参与本轮生成；他们名下已有的草稿稍后一并撤下
  const mutedIds = await store.listActiveMuteIds(today);
  const students = allStudents.filter((s) => !mutedIds.has(s.id));
  const byId = new Map(students.map((s) => [s.id, s]));
  const ids = allStudents.map((s) => s.id);
  let attempts = 0;
  let consecutiveFailures = 0;
  let stopped = null;
  let capped = false;

  const canStart = () => {
    if (stopped) return false;
    if (attempts >= maxDrafts) { stopped = 'cap'; return false; }
    if (clock() - startedAt >= budgetMs) { stopped = 'time'; return false; }
    if (consecutiveFailures >= 3) { stopped = 'failures'; return false; }
    return true;
  };
  const remaining = () => Math.max(0, maxDrafts - attempts);
  /** 只取还有名额做的那几位；有被截掉的就记 cap，后面的步骤本轮不再开始，留给下一轮 */
  const takeUpTo = (list) => {
    if (list.length > remaining()) capped = true;
    return list.slice(0, remaining());
  };

  // --- 一次性读入：未处理 / 已推迟的草稿、到期的推迟、最近 30 天的填写日期、最近的提醒时间 -----------------
  const [openRows, dueRows, dateRows, nudgeAtMap] = await Promise.all([
    store.listOpenDrafts(ids),
    store.listDueSnoozed(today),
    store.loadSessionDates(ids, addDays(today, -CONTEXT_DAYS), today),
    store.lastNudgeSentAt(ids, addDays(today, -7)),
  ]);
  const datesBy = new Map();
  for (const r of dateRows) {
    if (!datesBy.has(r.student_id)) datesBy.set(r.student_id, new Set());
    datesBy.get(r.student_id).add(dateOf(r.session_date));
  }
  const NONE = new Set();
  const datesOf = (id) => datesBy.get(id) || NONE;
  const gapOf = (id) => fillSummary(datesOf(id), today).gap;
  const lastNudgeDate = (id) => (nudgeAtMap.get(id) ? shanghaiDateOf(nudgeAtMap.get(id)) : null);

  const openBy = new Map(); // 学生 → 他唯一的 status = 'draft'
  const snoozedBy = new Map(); // 学生 → [status = 'snoozed' 的行]
  const droppedIds = new Set();

  const forget = (row) => {
    if (openBy.get(row.student_id)?.id === row.id) openBy.delete(row.student_id);
    const rest = (snoozedBy.get(row.student_id) || []).filter((r) => r.id !== row.id);
    if (rest.length) snoozedBy.set(row.student_id, rest); else snoozedBy.delete(row.student_id);
  };
  /** 撤下（dropped）一批草稿；失败只记日志，不拖垮这一轮 */
  async function dropRows(rows, reason) {
    const list = rows.filter((r) => r && !droppedIds.has(r.id));
    if (list.length === 0) return;
    try {
      await store.dropDrafts(list.map((r) => r.id), reason);
    } catch (err) {
      console.error('[supervision] 撤下草稿失败', reason, err?.message);
      return;
    }
    for (const r of list) { droppedIds.add(r.id); forget(r); }
    summary.dropped += list.length;
  }

  // 整理现状：同一学生有多条 draft（v1 留下的）只留最新的一条，保证「最多一条」
  const surplus = [];
  const newestFirst = [...openRows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))
    || String(b.id).localeCompare(String(a.id)));
  for (const r of newestFirst) {
    if (!byId.has(r.student_id)) continue;
    if (r.status === 'snoozed') {
      snoozedBy.set(r.student_id, [...(snoozedBy.get(r.student_id) || []), r]);
    } else if (openBy.has(r.student_id)) {
      surplus.push(r);
    } else {
      openBy.set(r.student_id, r);
    }
  }
  await dropRows(surplus, DROP_SUPERSEDED);

  // ⓪ 被隐藏 / 暂停：名下还没处理的草稿直接撤下，本轮也不再为这些学生生成
  if (mutedIds.size > 0) {
    await dropRows(openRows.filter((r) => mutedIds.has(r.student_id)), DROP_MUTED);
  }

  // ① 自动撤下：提醒发出之后学生自己记了（包括推迟中的）
  const hasRecordFrom = (id, date) => [...datesOf(id)].some((d) => d >= date);
  const allKnown = [...openBy.values(), ...[...snoozedBy.values()].flat()];
  await dropRows(
    allKnown.filter((d) => isNudgeDraft(d) && hasRecordFrom(d.student_id, shanghaiDateOf(d.created_at))),
    DROP_RECORDED,
  );

  // --- 公共小工具 ------------------------------------------------------------------------------------
  const avoid = []; // 这一轮已经写过的开头，传给后面的草稿避免雷同
  let pushMemo = null;
  const pushOf = async (id) => {
    if (!pushMemo) pushMemo = await store.recentInactivePush(ids, yesterday);
    return pushMemo.get(id) || null;
  };

  /** 把新草稿写进库，并让「一人最多一条 draft」成立：写成功后，旧的那条撤下。 */
  async function insertWithInvariant(row) {
    const inserted = await store.insertDraft(row);
    if (!inserted) return null;
    const older = openBy.get(row.student_id);
    openBy.set(row.student_id, inserted);
    if (older && older.id !== inserted.id) await dropRows([older], DROP_SUPERSEDED);
    return inserted;
  }

  async function metaOf(out, { studentId, reminder, combine = false, fromSnooze = false, recordsFrom = null }) {
    const meta = { why: out.why, facts: out.facts, alts: out.alts, lint: out.lint };
    if (combine) meta.nudge = true;
    if (reminder) {
      const push = await pushOf(studentId);
      if (push && push >= yesterday) {
        meta.system_push_date = push;
        meta.recommend_snooze = SNOOZE_RECOMMEND;
      }
    }
    if (fromSnooze) meta.from_snooze = true;
    if (recordsFrom) meta.records_from = recordsFrom;
    return meta;
  }

  async function compose(student, kind, period, records, extra = {}) {
    const ctxFrom = addDays(period.start, -CONTEXT_DAYS);
    const more = await gatherExtras(store, student.id, ctxFrom, period.end);
    const out = await composeDraft({
      kind, student, period, records, today, generate, env, avoidOpenings: [...avoid], ...more, ...extra,
    });
    if (!out.empty) avoid.push(openingOf(out.body));
    return out;
  }

  /** 一次「生成尝试」：占一个名额，成功清零连续失败，失败计数并记日志。返回 'stop' 表示这一轮该停了。 */
  async function attempt(label, studentId, fn) {
    if (!canStart()) return 'stop';
    attempts += 1;
    try {
      await fn();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      summary.failed += 1;
      console.error('[supervision] 生成失败', label, studentId, err?.message);
    }
    return 'ok';
  }

  const groupByStudent = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.student_id)) m.set(r.student_id, []);
      m.get(r.student_id).push(r);
    }
    return m;
  };

  /** 提醒的间隔：最近 3 天内发过 / 推迟过 / 跳过的不再提醒；手上还压着一条推迟的也不再提醒 */
  const nudgeAllowed = (id) => {
    if (snoozedBy.has(id)) return false;
    const last = lastNudgeDate(id);
    return last == null || daysBetween(last, today) >= NUDGE_MIN_INTERVAL_DAYS;
  };

  // ② 「过几天再说」到期：按学生今天需要什么重写
  for (const row of dueRows) {
    if (stopped) break;
    const student = byId.get(row.student_id);
    if (!student || row.status !== 'snoozed' || droppedIds.has(row.id)) continue;
    // 推迟期间已经有了更新的一条 → 这条直接撤下，不再重写
    if (openBy.has(student.id)) { await dropRows([row], DROP_SUPERSEDED); continue; }

    const rowStart = dateOf(row.period_start);
    const rowEnd = dateOf(row.period_end);
    const dates = datesOf(student.id);
    let plan; // { kind, replace, period, recordsFrom?, update }
    if (row.kind === 'nudge') {
      plan = { kind: 'nudge', period: periodOf('nudge', today), update: { period_end: today } };
    } else if (row.kind === 'weekly') {
      const lw = periodOf('weekly', today);
      // 周一时，上上周的小结已经过期，由下面的周小结步骤重新出新的
      if (isoWeekday(today) === 1 && rowStart < lw.start) { await dropRows([row], DROP_SUPERSEDED); continue; }
      plan = { kind: 'weekly', period: { start: rowStart, end: rowEnd }, update: {}, combine: row.meta?.nudge === true };
    } else {
      const since = [...dates].filter((d) => d > rowEnd);
      if (since.some((d) => d <= yesterday)) {
        const from = addDays(rowEnd, 1);
        plan = { kind: 'daily', period: { start: from, end: yesterday }, recordsFrom: from, update: { period_end: yesterday } };
      } else if (dates.has(today)) {
        await dropRows([row], DROP_RECORDED); // 只有今天的记录，没有可夸的「昨天」；明天的每日草稿会接上
        continue;
      } else {
        plan = { kind: 'nudge', replace: true, period: periodOf('nudge', today) };
      }
    }

    const res = await attempt(`返回 ${plan.kind}`, student.id, async () => {
      const records = await store.loadRecords([student.id], addDays(plan.period.start, -CONTEXT_DAYS), plan.period.end);
      const reminder = plan.kind === 'nudge' || plan.combine;
      const out = await compose(student, plan.kind, plan.period, records, {
        combineNudge: Boolean(plan.combine),
        nudge: reminder ? nudgeInputOf(student, today, dates.size > 0) : null,
      });
      if (out.empty) { await dropRows([row], '这一期没有可用的记录'); return; }
      const meta = await metaOf(out, {
        studentId: student.id, reminder, combine: Boolean(plan.combine), fromSnooze: true, recordsFrom: plan.recordsFrom,
      });
      if (plan.replace) {
        // 种类变了（每日 → 提醒）：新插一条，旧的撤下
        const inserted = await insertWithInvariant({
          student_id: student.id, kind: 'nudge', period_start: plan.period.start, period_end: plan.period.end,
          body: out.body, evidence: out.evidence, model: out.model, meta,
        });
        await dropRows([row], DROP_SUPERSEDED);
        if (inserted) { summary.created += 1; summary.nudge += 1; }
        return;
      }
      // 原位重写：保留 period_start（唯一键不变），回到 draft，清掉导师改过的版本和处理痕迹
      const updated = await store.updateDraft(row.id, {
        body: out.body, edited_body: null, evidence: out.evidence, model: out.model, status: 'draft',
        handled_by: null, handled_at: null, snooze_until: null, skip_reason: null, meta, ...plan.update,
      });
      forget(row);
      openBy.set(student.id, updated || { ...row, status: 'draft' });
      summary.returned += 1;
    });
    if (res === 'stop') break;
  }

  // ③ 每周：只在周一，首月之后，上一整周有记录；同时已经好几天没记的，在周小结里顺带提醒
  if (!stopped && isoWeekday(today) === 1) {
    const week = periodOf('weekly', today);
    const weekly = students.filter((s) => phaseOf(s.created_at, today) === 'weekly'
      && [...datesOf(s.id)].some((d) => d >= week.start && d <= week.end));
    const have = await store.listDraftStudentIds('weekly', week.start, week.end);
    const todo = takeUpTo(weekly.filter((s) => !have.has(s.id)));
    const rows = todo.length ? await store.loadRecords(todo.map((s) => s.id), addDays(week.start, -CONTEXT_DAYS), week.end) : [];
    const byStudent = groupByStudent(rows);
    for (const student of todo) {
      const records = byStudent.get(student.id) || [];
      if (!records.some((r) => r.session_date >= week.start && r.session_date <= week.end)) continue;
      const combine = gapOf(student.id) >= NUDGE_GAP_WEEKLY && nudgeAllowed(student.id);
      const res = await attempt('weekly', student.id, async () => {
        const out = await compose(student, 'weekly', week, records, {
          combineNudge: combine, nudge: combine ? { neverRecorded: false, phase: 'weekly' } : null,
        });
        if (out.empty) return;
        const meta = await metaOf(out, { studentId: student.id, reminder: combine, combine });
        const inserted = await insertWithInvariant({
          student_id: student.id, kind: 'weekly', period_start: week.start, period_end: week.end,
          body: out.body, evidence: out.evidence, model: out.model, meta,
        });
        if (inserted) { summary.created += 1; summary.weekly += 1; }
      });
      if (res === 'stop') break;
    }
  }

  // ④ 每日：首月第 2 天起，昨天有记录 → 一句表扬
  if (!stopped) {
    const daily = students.filter((s) => {
      const n = dayNumber(s.created_at, today);
      return phaseOf(s.created_at, today) === 'daily' && n >= 2 && datesOf(s.id).has(yesterday);
    });
    const have = await store.listDraftStudentIds('daily', yesterday, yesterday);
    const todo = takeUpTo(daily.filter((s) => !have.has(s.id)));
    const rows = todo.length
      ? await store.loadRecords(todo.map((s) => s.id), addDays(yesterday, -CONTEXT_DAYS), yesterday) : [];
    const byStudent = groupByStudent(rows);
    const period = periodOf('daily', today);
    for (const student of todo) {
      const records = byStudent.get(student.id) || [];
      if (!records.some((r) => r.session_date === yesterday)) continue;
      const res = await attempt('daily', student.id, async () => {
        const out = await compose(student, 'daily', period, records);
        if (out.empty) return;
        const meta = await metaOf(out, { studentId: student.id, reminder: false });
        const inserted = await insertWithInvariant({
          student_id: student.id, kind: 'daily', period_start: period.start, period_end: period.end,
          body: out.body, evidence: out.evidence, model: out.model, meta,
        });
        if (inserted) { summary.created += 1; summary.daily += 1; }
      });
      if (res === 'stop') break;
    }
  }

  // ⑤ 提醒：没有今天的草稿、间隔够 3 天、记录断了
  if (!stopped) {
    const qualifies = (s) => {
      const n = dayNumber(s.created_at, today);
      const gap = gapOf(s.id);
      if (phaseOf(s.created_at, today) === 'daily') {
        if (n == null || n < 2) return false;
        return gap == null ? n >= NUDGE_NEVER_FROM_DAY : gap >= NUDGE_GAP_FIRST_MONTH;
      }
      return gap == null || gap >= NUDGE_GAP_WEEKLY;
    };
    const blockedByOpen = (id) => {
      const open = openBy.get(id);
      // 手上已经有一条没处理的：提醒 / 周小结继续用它；只有前几天的每日表扬会被今天的提醒顶掉（推迟后重写的除外）
      return Boolean(open) && !(open.kind === 'daily' && !open.meta?.from_snooze && shanghaiDateOf(open.created_at) < today);
    };
    const have = await store.listDraftStudentIds('nudge', today, today);
    const todo = takeUpTo(
      students.filter((s) => qualifies(s) && !blockedByOpen(s.id) && nudgeAllowed(s.id) && !have.has(s.id)),
    );
    const rows = todo.length ? await store.loadRecords(todo.map((s) => s.id), addDays(today, -CONTEXT_DAYS), today) : [];
    const byStudent = groupByStudent(rows);
    const period = periodOf('nudge', today);
    for (const student of todo) {
      const records = byStudent.get(student.id) || [];
      const res = await attempt('nudge', student.id, async () => {
        const out = await compose(student, 'nudge', period, records, {
          nudge: nudgeInputOf(student, today, datesOf(student.id).size > 0),
        });
        const meta = await metaOf(out, { studentId: student.id, reminder: true });
        const inserted = await insertWithInvariant({
          student_id: student.id, kind: 'nudge', period_start: period.start, period_end: period.end,
          body: out.body, evidence: out.evidence, model: out.model, meta,
        });
        if (inserted) { summary.created += 1; summary.nudge += 1; }
      });
      if (res === 'stop') break;
    }
  }

  if (stopped) summary.skipped = { [stopped]: true };
  else if (capped) summary.skipped = { cap: true };
  return summary;
}

/**
 * 重新生成一份已有草稿：同一期的记录，覆盖 body，清掉导师改过的版本，状态回到 draft，并刷新 meta.alts。
 * 支持 daily / weekly / nudge，以及「周小结 + 提醒」（meta.nudge）。
 * 草稿回到 draft 后，这位学生别的未处理草稿会被撤下（一人最多一条）。
 * @returns {Promise<object>} 更新后的草稿行
 */
export async function regenerateDraft({
  store, draft, generate = defaultGenerate, env = process.env, now = new Date(),
}) {
  if (draft.status === 'dropped') {
    throw Object.assign(new Error('这条已经被撤下，不能重新生成'), { status: 409 });
  }
  const student = await store.getProfile(draft.student_id);
  if (!student) throw Object.assign(new Error('找不到这位学生'), { status: 404 });
  const today = shanghaiToday(now);
  const meta0 = draft.meta || {};
  const period = { start: dateOf(draft.period_start), end: dateOf(draft.period_end) };
  const combine = draft.kind === 'weekly' && meta0.nudge === true;

  let composePeriod = period;
  let asOf = today;
  if (draft.kind === 'nudge') {
    composePeriod = periodOf('nudge', today);
  } else if (draft.kind === 'daily') {
    // 推迟后原位重写的每日表扬只用「推迟之后的记录」；dayN 与当时生成时一致：以「期末的次日」为那天的「今天」
    composePeriod = meta0.records_from ? { start: meta0.records_from, end: period.end } : period;
    asOf = addDays(period.end, 1);
  }
  const from = addDays(composePeriod.start, -CONTEXT_DAYS);
  const records = await store.loadRecords([draft.student_id], from, composePeriod.end);
  const reminder = draft.kind === 'nudge' || combine;
  const nudge = !reminder ? null
    : combine ? { neverRecorded: false, phase: 'weekly' }
      : nudgeInputOf(student, today, records.length > 0);

  const more = await gatherExtras(store, draft.student_id, from, composePeriod.end);
  const out = await composeDraft({
    kind: draft.kind, student, period: composePeriod, records, today: asOf, generate, env,
    combineNudge: combine, nudge, ...more,
  });
  if (out.empty) throw Object.assign(new Error('这一期没有可用的记录，无法重新生成'), { status: 409 });

  // meta：说明性字段重新生成（alts 清掉再填），提醒相关的标记保留
  const meta = { why: out.why, facts: out.facts, alts: out.alts, lint: out.lint };
  for (const k of ['nudge', 'system_push_date', 'recommend_snooze', 'from_snooze', 'records_from']) {
    if (meta0[k] !== undefined) meta[k] = meta0[k];
  }
  const updated = await store.updateDraft(draft.id, {
    body: out.body,
    edited_body: null,
    evidence: out.evidence,
    model: out.model,
    status: 'draft',
    handled_by: null,
    handled_at: null,
    snooze_until: null,
    skip_reason: null,
    meta,
  });
  const others = (await store.listOpenDrafts([draft.student_id]))
    .filter((d) => d.status === 'draft' && d.id !== draft.id);
  if (others.length) await store.dropDrafts(others.map((d) => d.id), DROP_SUPERSEDED);
  return updated;
}

// ---------------------------------------------------------------------------
// Supabase REST store（service role）
// ---------------------------------------------------------------------------

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const inList = (ids) => `in.(${ids.map((i) => encodeURIComponent(i)).join(',')})`;
const maxBy = (map, key, value) => {
  if (value && (!map.has(key) || value > map.get(key))) map.set(key, value);
};

export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch }) {
  const base = String(url || '').replace(/\/$/, '');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  const request = (path, { method = 'GET', body, prefer } = {}) =>
    fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function getJson(path) {
    const res = await request(path);
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${path.split('?')[0]}`);
    return res.json();
  }

  async function getAll(path) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await getJson(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  const DRAFT_BRIEF = 'id,student_id,kind,status,period_start,period_end,created_at,meta';

  return {
    /** 学生（role 1）里至少有一条 status = 1 连接的。@returns {Promise<{id, created_at}[]>} */
    async listScopeStudents() {
      const conns = await getAll('teacher_student_connections?select=student_id&status=eq.1&order=student_id.asc');
      const ids = [...new Set(conns.map((c) => c.student_id))];
      const out = [];
      for (const part of chunk(ids, IN_CHUNK)) {
        out.push(...(await getJson(`profiles?select=id,created_at&role=eq.1&id=${inList(part)}`)));
      }
      return out;
    },
    async getProfile(id) {
      const [row] = await getJson(`profiles?select=id,created_at,role&id=eq.${encodeURIComponent(id)}`);
      return row || null;
    },
    /**
     * 当前生效的隐藏 / 暂停：hidden 永久；snoozed 到 until（含）为止。
     * @returns {Promise<Set<string>>} 学生 id
     */
    async listActiveMuteIds(today) {
      let rows;
      try {
        rows = await getAll('supervision_mutes?select=student_id,mode,until');
      } catch (err) {
        // 011 迁移还没跑时表不存在：当作没人被隐藏，别让整轮停掉
        console.error('[supervision] 读取 supervision_mutes 失败，本轮不过滤', err?.message);
        return new Set();
      }
      return new Set(rows
        .filter((r) => r.mode === 'hidden'
          || (r.mode === 'snoozed' && r.until && dateOf(r.until) >= today))
        .map((r) => r.student_id));
    },
    /**
     * 该期已经有草稿的学生 id 集合（任何状态，含 dropped）。
     * period_start 或 period_end 对上都算：推迟后原位重写的每日草稿保留旧 period_start、period_end 改成昨天。
     */
    async listDraftStudentIds(kind, periodStart, periodEnd = periodStart) {
      const rows = await getAll(
        `supervision_drafts?select=student_id&kind=eq.${kind}&or=(period_start.eq.${periodStart},period_end.eq.${periodEnd})`
          + '&order=id.asc',
      );
      return new Set(rows.map((r) => r.student_id));
    },
    /** @returns {Promise<Array>} 平铺的记录：含 id、student_id、course_id 与课程 / 章节 / 单元名称 */
    async loadRecords(studentIds, from, to) {
      const out = [];
      for (const part of chunk(studentIds, IN_CHUNK)) {
        const rows = await getAll(
          'learning_sessions?select=id,student_id,session_date,start_time,end_time,category,form,duration_minutes,'
            + 'self_rating,grade_label,notes,course_id,chapter_id,unit_id,courses(name),chapters(name),units(name)'
            + `&deleted_at=is.null&session_date=gte.${from}&session_date=lte.${to}&student_id=${inList(part)}`
            + '&order=session_date.asc,start_time.asc',
        );
        for (const r of rows) {
          const { courses, chapters, units, ...rest } = r;
          out.push({ ...rest, course: courses?.name || '', chapter: chapters?.name || '', unit: units?.name || '' });
        }
      }
      return out;
    },
    /** 只取日期（不带课程等关联），给「谁几天没记」用，比 loadRecords 轻得多。@returns {Promise<{student_id, session_date}[]>} */
    async loadSessionDates(studentIds, from, to) {
      const out = [];
      for (const part of chunk(studentIds, IN_CHUNK)) {
        out.push(...await getAll(
          'learning_sessions?select=student_id,session_date'
            + `&deleted_at=is.null&session_date=gte.${from}&session_date=lte.${to}&student_id=${inList(part)}`
            + '&order=student_id.asc,session_date.asc,id.asc',
        ));
      }
      return out;
    },
    /** 未处理（draft）和已推迟（snoozed）的草稿，只取判断用的几列 */
    async listOpenDrafts(studentIds) {
      const out = [];
      for (const part of chunk(studentIds, IN_CHUNK)) {
        out.push(...await getAll(
          `supervision_drafts?select=${DRAFT_BRIEF}&status=in.(draft,snoozed)&student_id=${inList(part)}`
            + '&order=created_at.asc,id.asc',
        ));
      }
      return out;
    },
    /** 推迟到期（snooze_until ≤ today）的草稿 */
    async listDueSnoozed(today) {
      return getAll(
        `supervision_drafts?select=${DRAFT_BRIEF}&status=eq.snoozed&snooze_until=lte.${today}&order=snooze_until.asc,id.asc`,
      );
    },
    /**
     * 每位学生最近一次「提醒被处理」的时间（handled_at）：提醒类草稿（kind = nudge，或周小结里 meta.nudge）
     * 状态为 sent / snoozed / skipped。跳过也算：导师说「请假了」之后不该第二天又出一条。
     * @returns {Promise<Map<string, string>>} 学生 id → handled_at
     */
    async lastNudgeSentAt(studentIds, sinceDate) {
      const out = new Map();
      for (const part of chunk(studentIds, IN_CHUNK)) {
        const rows = await getAll(
          'supervision_drafts?select=student_id,handled_at&status=in.(sent,snoozed,skipped)&handled_at=not.is.null'
            + '&or=(kind.eq.nudge,meta-%3E%3Enudge.eq.true)'
            + `${sinceDate ? `&handled_at=gte.${sinceDate}T00:00:00Z` : ''}`
            + `&student_id=${inList(part)}&order=handled_at.desc,id.asc`,
        );
        for (const r of rows) maxBy(out, r.student_id, r.handled_at);
      }
      return out;
    },
    /** 这位学生上一条真正发出的消息（status = sent，导师改过的以改后为准）。@returns {Promise<{text, date}|null>} */
    async lastSent(studentId) {
      const [row] = await getJson(
        'supervision_drafts?select=body,edited_body,handled_at&status=eq.sent&handled_at=not.is.null'
          + `&student_id=eq.${encodeURIComponent(studentId)}&order=handled_at.desc&limit=1`,
      );
      if (!row) return null;
      return { text: row.edited_body || row.body, date: shanghaiDateOf(row.handled_at) };
    },
    /** 导师最近改过的写法（原稿 → 改后），最多 3 条。@returns {Promise<{before, after}[]>} */
    async styleRefs(studentId) {
      const rows = await getJson(
        'supervision_drafts?select=body,edited_body&edited_body=not.is.null&status=neq.dropped'
          + `&student_id=eq.${encodeURIComponent(studentId)}&order=updated_at.desc&limit=10`,
      );
      return rows
        .filter((r) => r.edited_body && r.edited_body.trim() !== String(r.body || '').trim())
        .slice(0, 3)
        .map((r) => ({ before: r.body, after: r.edited_body }));
    },
    /** 导师以「这条写得不合适」跳过的稿，最近 2 条原文 */
    async rejected(studentId) {
      const rows = await getJson(
        'supervision_drafts?select=body&status=eq.skipped'
          + `&skip_reason=eq.${encodeURIComponent(REJECTED_REASON)}`
          + `&student_id=eq.${encodeURIComponent(studentId)}&order=handled_at.desc.nullslast&limit=2`,
      );
      return rows.map((r) => r.body);
    },
    /** since 之后系统给学生发过「几天没记」推送（push_deliveries.kind = 'inactive'）。@returns {Promise<Map<string, string>>} 学生 id → 最近的 sent_date */
    async recentInactivePush(studentIds, sinceDate) {
      const out = new Map();
      for (const part of chunk(studentIds, IN_CHUNK)) {
        const rows = await getAll(
          `push_deliveries?select=user_id,sent_date&kind=eq.inactive&sent_date=gte.${sinceDate}`
            + `&user_id=${inList(part)}&order=sent_date.desc,id.asc`,
        );
        for (const r of rows) maxBy(out, r.user_id, dateOf(r.sent_date));
      }
      return out;
    },
    /** 区间内的考试成绩（未删除）。@returns {Promise<{student_id, date, course, name, grade_label, score, notes}[]>} */
    async loadExams(studentIds, from, to) {
      const out = [];
      for (const part of chunk(studentIds, IN_CHUNK)) {
        const rows = await getAll(
          'exam_scores?select=student_id,exam_date,exam_name,score,grade_label,notes,courses(name)'
            + `&deleted_at=is.null&exam_date=gte.${from}&exam_date=lte.${to}&student_id=${inList(part)}`
            + '&order=exam_date.asc,id.asc',
        );
        for (const r of rows) {
          out.push({
            student_id: r.student_id,
            date: dateOf(r.exam_date),
            course: r.courses?.name || '',
            name: r.exam_name,
            grade_label: r.grade_label ?? null,
            score: r.score == null ? null : Number(r.score),
            notes: r.notes ?? null,
          });
        }
      }
      return out;
    },
    /**
     * 把草稿撤下：status → dropped，meta.drop_reason = reason（合并进原 meta）。
     * 只动仍是 draft / snoozed 的行：期间被导师处理掉（sent / skipped）的不会被覆盖。
     * @returns {Promise<number>} 实际撤下的条数
     */
    async dropDrafts(ids, reason) {
      let n = 0;
      for (const part of chunk(ids, IN_CHUNK)) {
        const rows = await getJson(`supervision_drafts?select=id,meta&id=${inList(part)}&status=in.(draft,snoozed)`);
        // 原 meta 相同的行合并成一次请求（v1 遗留的草稿 meta 都是 {}，一次就撤完）
        const groups = new Map();
        for (const r of rows) {
          const key = JSON.stringify(r.meta || {});
          if (!groups.has(key)) groups.set(key, { meta: r.meta || {}, ids: [] });
          groups.get(key).ids.push(r.id);
        }
        for (const g of groups.values()) {
          const res = await request(`supervision_drafts?id=${inList(g.ids)}&status=in.(draft,snoozed)`, {
            method: 'PATCH',
            body: { status: 'dropped', meta: { ...g.meta, drop_reason: reason } },
            prefer: 'return=representation',
          });
          if (!res.ok) throw new Error(`Supabase ${res.status}: supervision_drafts drop`);
          n += (await res.json()).length;
        }
      }
      return n;
    },
    /** 插入草稿；唯一键冲突（重复运行）返回 null */
    async insertDraft(row) {
      const res = await request('supervision_drafts', { method: 'POST', body: row, prefer: 'return=representation' });
      if (res.status === 409) return null;
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        if (err?.code === '23505') return null;
        throw new Error(`Supabase ${res.status}: supervision_drafts insert`);
      }
      const [created] = await res.json();
      return created || null;
    },
    async getDraft(id) {
      const [row] = await getJson(`supervision_drafts?select=*&id=eq.${encodeURIComponent(id)}`);
      return row || null;
    },
    async updateDraft(id, patch) {
      const res = await request(`supervision_drafts?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', body: patch, prefer: 'return=representation',
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: supervision_drafts update`);
      const [row] = await res.json();
      return row || null;
    },
    /** 这位导师与该学生是否有 status = 1 的连接 */
    async hasActiveConnection(teacherId, studentId) {
      const rows = await getJson(
        'teacher_student_connections?select=id&status=eq.1'
          + `&teacher_id=eq.${encodeURIComponent(teacherId)}&student_id=eq.${encodeURIComponent(studentId)}&limit=1`,
      );
      return rows.length > 0;
    },
  };
}
