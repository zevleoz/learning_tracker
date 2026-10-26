// AI 监督流程的服务端：数据访问（service role）+ 定时任务 + 单条重新生成。
// 只在服务端使用（api/supervision/index.js），绝不进入前端 bundle。
//
// 草稿只给导师看：
//   daily  新生（第 2–30 天）昨天有记录 → 一句表扬（period = 昨天）
//   weekly 非新生，每周一对上一个完整周（周一到周日）生成一段小结
//          「要提的问题」由本文件用代码判定（detectWeeklyIssues），模型不自己找问题
// 给模型的记录只有课程 / 章节 / 单元名称，不含学生姓名。
import {
  addDays, dayNumber, lastWeekRange, phaseOf, shanghaiToday,
} from '../src/lib/supervision.js';
import { generateDraft as defaultGenerate, modelNameOf } from './supervision-prompt.mjs';

export const MAX_DRAFTS_PER_RUN = 15;
export const RUN_BUDGET_MS = 28 * 1000; // 最坏一份草稿 3 次模型请求 × 10 秒，须在 60 秒函数上限内收尾
export const QUIET_FROM_HOUR = 23; // 上海时间 23:00 起不跑
export const QUIET_TO_HOUR = 6; // 到 06:00 为止不跑
export const MAX_RECORDS_PER_DRAFT = 60;
export const PREV_WEEKS_LOOKBACK = 3;
export const MAX_ISSUES = 4;

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

/** 取 [from, to] 内的记录，按时间排序，最多 MAX_RECORDS_PER_DRAFT 条（保留最近的）。 */
export function recordsInRange(records, from, to) {
  const list = records.filter((r) => r.session_date >= from && r.session_date <= to).sort(byTime);
  return list.length > MAX_RECORDS_PER_DRAFT ? list.slice(-MAX_RECORDS_PER_DRAFT) : list;
}

/** 提示词需要的字段（不含 id / 学生信息）。 */
export function toPromptRecord(r) {
  return {
    session_date: r.session_date,
    start_time: r.start_time,
    end_time: r.end_time,
    course: r.course,
    chapter: r.chapter,
    unit: r.unit,
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

/** 某位学生某一期（daily: 昨天；weekly: 上一整周）需要的记录范围 */
export function periodOf(kind, today) {
  if (kind === 'weekly') return lastWeekRange(today);
  const y = addDays(today, -1);
  return { start: y, end: y };
}

/**
 * 为一位学生生成一份草稿内容（不写库）。
 * @returns {Promise<{ body: string, evidence: string[], model: string } | { empty: true }>}
 */
export async function composeDraft({ kind, student, period, records, today, generate, env }) {
  const inPeriod = records.filter((r) => r.session_date >= period.start && r.session_date <= period.end);
  if (inPeriod.length === 0) return { empty: true };
  const picked = recordsInRange(records, period.start, period.end);
  const input = { kind, records: picked.map(toPromptRecord) };
  if (kind === 'daily') {
    input.dayN = dayNumber(student.created_at, today);
  } else {
    input.issues = detectWeeklyIssues(records, period);
  }
  const draft = await generate(input, env);
  return { body: draft.text, evidence: evidenceIds(draft.evidence, picked), model: modelNameOf(env) };
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
  const summary = { created: 0, failed: 0, skipped: {}, daily: 0, weekly: 0 };
  if (inQuietHours(now)) return { ...summary, skipped: { quiet: true } };

  const today = shanghaiToday(now);
  const startedAt = clock();
  const students = await store.listScopeStudents();
  let attempts = 0;
  let consecutiveFailures = 0;
  let stopped = null;

  const canStart = () => {
    if (stopped) return false;
    if (attempts >= maxDrafts) { stopped = 'cap'; return false; }
    if (clock() - startedAt >= budgetMs) { stopped = 'time'; return false; }
    if (consecutiveFailures >= 3) { stopped = 'failures'; return false; }
    return true;
  };

  async function runKind(kind, candidates, period, from) {
    if (candidates.length === 0) return;
    const have = await store.listDraftStudentIds(kind, period.start);
    const todo = candidates.filter((s) => !have.has(s.id));
    if (todo.length === 0) return;
    const rows = await store.loadRecords(todo.map((s) => s.id), from, period.end);
    const byStudent = new Map();
    for (const r of rows) {
      if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
      byStudent.get(r.student_id).push(r);
    }
    for (const student of todo) {
      const records = byStudent.get(student.id) || [];
      if (!records.some((r) => r.session_date >= period.start && r.session_date <= period.end)) continue;
      if (!canStart()) return;
      attempts += 1;
      try {
        const out = await composeDraft({ kind, student, period, records, today, generate, env });
        if (out.empty) continue;
        const inserted = await store.insertDraft({
          student_id: student.id,
          kind,
          period_start: period.start,
          period_end: period.end,
          body: out.body,
          evidence: out.evidence,
          model: out.model,
        });
        consecutiveFailures = 0;
        if (inserted) {
          summary.created += 1;
          summary[kind] += 1;
        }
      } catch (err) {
        consecutiveFailures += 1;
        summary.failed += 1;
        console.error('[supervision] 生成失败', kind, student.id, err?.message);
      }
    }
  }

  // 每日：新生（第 2–30 天）昨天有记录
  const dailyStudents = students.filter((s) => {
    const n = dayNumber(s.created_at, today);
    return phaseOf(s.created_at, today) === 'daily' && n >= 2;
  });
  const yesterday = periodOf('daily', today);
  await runKind('daily', dailyStudents, yesterday, yesterday.start);

  // 每周：只在周一，非新生，上一整周有记录
  if (isoWeekday(today) === 1) {
    const weeklyStudents = students.filter((s) => phaseOf(s.created_at, today) === 'weekly');
    const week = periodOf('weekly', today);
    await runKind('weekly', weeklyStudents, week, addDays(week.start, -7 * PREV_WEEKS_LOOKBACK));
  }

  if (stopped) summary.skipped = { [stopped]: true };
  return summary;
}

/**
 * 重新生成一份已有草稿：同一期的记录，覆盖 body，清掉导师改过的版本，状态回到 draft。
 * @returns {Promise<object>} 更新后的草稿行
 */
export async function regenerateDraft({
  store, draft, generate = defaultGenerate, env = process.env, now = new Date(),
}) {
  const student = await store.getProfile(draft.student_id);
  if (!student) throw Object.assign(new Error('找不到这位学生'), { status: 404 });
  const period = { start: String(draft.period_start).slice(0, 10), end: String(draft.period_end).slice(0, 10) };
  const from = draft.kind === 'weekly' ? addDays(period.start, -7 * PREV_WEEKS_LOOKBACK) : period.start;
  const records = await store.loadRecords([draft.student_id], from, period.end);
  // dayN 与当时生成时一致：以「期末的次日」为那天的「今天」
  const asOf = draft.kind === 'daily' ? addDays(period.end, 1) : shanghaiToday(now);
  const out = await composeDraft({ kind: draft.kind, student, period, records, today: asOf, generate, env });
  if (out.empty) throw Object.assign(new Error('这一期没有可用的记录，无法重新生成'), { status: 409 });
  return store.updateDraft(draft.id, {
    body: out.body,
    edited_body: null,
    evidence: out.evidence,
    model: out.model,
    status: 'draft',
    handled_by: null,
    handled_at: null,
  });
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
    /** 该期已经有草稿的学生 id 集合 */
    async listDraftStudentIds(kind, periodStart) {
      const rows = await getAll(
        `supervision_drafts?select=student_id&kind=eq.${kind}&period_start=eq.${periodStart}`,
      );
      return new Set(rows.map((r) => r.student_id));
    },
    /** @returns {Promise<Array>} 平铺的记录：含 id、student_id、course_id 与课程 / 章节 / 单元名称 */
    async loadRecords(studentIds, from, to) {
      const out = [];
      for (const part of chunk(studentIds, IN_CHUNK)) {
        const rows = await getAll(
          'learning_sessions?select=id,student_id,session_date,start_time,end_time,category,form,duration_minutes,'
            + 'self_rating,grade_label,notes,course_id,courses(name),chapters(name),units(name)'
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
