// 学习记录（learning_sessions）的保存规则——学生端录入的唯一来源。
// 从 Learning.jsx 原样抽出：主观评价 / 客观评价 / 待补填 的口径一律不许在 UI 层另写一套。
//
// 规则摘要（与改版前完全一致）：
// - 主观评价：每条必填，SUBJECTIVE_STEPS 五档，默认「基本掌握」(80)，始终写入 self_rating。
// - 客观评价：仅练习（category=3）且可选。现在填写（默认 B+）/ 稍后补充（grade_label=null，进待补填）/
//   N/A 不适用（grade_label='N/A'，不进待补填）。非练习一律 grade_label=null。
// - eval_type：保存了客观值（含 N/A）为 2，否则为 1。
// - 待补填：category=3 且 grade_label is null 且 score is null 且 deleted_at is null。

import { SUBJECTIVE_STEPS } from './rating.js';

// 学习行为类别（category）— 与数据库/分析面板一致：1=学习 2=复习 3=练习
export const CATEGORY_OPTS = [
  { key: 1, label: '学习' },
  { key: 2, label: '复习' },
  { key: 3, label: '练习' },
];

// 学习行为形式（预设 form，按类别分组）；用户自定义项在任意类别下都可选
export const FORM_PRESET_BY_CATEGORY = {
  1: ['自主预习', '校外线上', '校外线下'],                                 // 学习
  2: ['自主复习', '校外线上', '校外线下'],                                 // 复习
  3: ['自主练习', '校外线上', '校外线下', '课外作业', '学校作业'],          // 练习
};
export const ALL_FORM_PRESET = Array.from(new Set(Object.values(FORM_PRESET_BY_CATEGORY).flat()));

// 客观评价 13 档
export const OBJECTIVE_STEPS = [
  { value: 0,  label: 'F'  },
  { value: 1,  label: 'D-' },
  { value: 2,  label: 'D'  },
  { value: 3,  label: 'D+' },
  { value: 4,  label: 'C-' },
  { value: 5,  label: 'C'  },
  { value: 6,  label: 'C+' },
  { value: 7,  label: 'B-' },
  { value: 8,  label: 'B'  },
  { value: 9,  label: 'B+' },
  { value: 10, label: 'A-' },
  { value: 11, label: 'A'  },
  { value: 12, label: 'A+' },
];

// letter grade → 百分制区间（参考显示）
export const GRADE_RANGES = {
  'A+': '97–100',
  'A':  '93–96',
  'A-': '90–92',
  'B+': '87–89',
  'B':  '83–86',
  'B-': '80–82',
  'C+': '77–79',
  'C':  '73–76',
  'C-': '70–72',
  'D+': '67–69',
  'D':  '63–66',
  'D-': '60–62',
  'F':  '0–59',
};

export const DEFAULT_SUBJ_IDX = 3; // 基本掌握 → 80
export const DEFAULT_OBJ_IDX = 9;  // B+

// 新建记录时评价相关的初始状态
export const DEFAULT_EVAL_STATE = Object.freeze({
  subjIdx: DEFAULT_SUBJ_IDX,
  objIdx: DEFAULT_OBJ_IDX,
  objDeferred: false, // 现在填写
  isObjNA: false,
});

function pad(n) { return String(n).padStart(2, '0'); }

/** 开始/结束（HH:MM）→ 用时分钟；跨午夜按次日计。缺值或非法返回 null。 */
export function computeDuration(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return null;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;       // 跨午夜
  return mins;
}

/**
 * 桌面端快捷输入：1430 → 14:30、14:30 → 14:30、2:30 → 02:30、930 → 09:30。
 * 三 / 四位纯数字按 HHMM / HMM 解析；冒号写法分钟必须两位。非法一律 null。
 */
export function parseTimeShorthand(str) {
  const s = String(str == null ? '' : str).trim();
  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
  }
  const digits = s.match(/^(\d{3,4})$/);
  if (digits) {
    const raw = digits[1];
    const h = Number(raw.slice(0, raw.length - 2));
    const m = Number(raw.slice(-2));
    return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : null;
  }
  return null;
}

/** HH:MM 加减分钟（按 24 小时取模）。 */
export function shiftTime(timeStr, deltaMinutes) {
  const [h, m] = String(timeStr).split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function addDaysStr(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/**
 * 时长优先：已知结束时刻（HH:MM）和结束所在日，往前推 minutes 得到开始时刻与「开始所在日」。
 * session_date 一律取开始所在日（与改版前手填跨午夜记录一致：日期=开始日，结束时间<开始时间）。
 * minutes 必须是 1–1440 的有限数，否则返回 null。
 */
export function startFromEnd(endStr, endDateStr, minutes) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1 || m > 24 * 60) return null;
  const [h, mm] = String(endStr).split(':').map(Number);
  if ([h, mm].some(Number.isNaN)) return null;
  const total = h * 60 + mm - m;
  return {
    startStr: shiftTime(endStr, -m),
    dateStr: total < 0 ? addDaysStr(endDateStr, -1) : endDateStr,
  };
}

/**
 * 选时长时以哪个时间为准：typed 为学生亲手填过的时间（'start' | 'end'），最近的在前。
 * 学生填的时间不被时长覆盖：最近填的那个保持不动，另一个按时长推算；都没填过则以结束（=现在）为准。
 */
export function durationAnchor(typed) {
  return (typed && typed[0]) === 'start' ? 'start' : 'end';
}

/** 已知开始时刻往后推 minutes 得到结束时刻（跨午夜按次日，日期仍记开始日）；时长非法返回 null。 */
export function endFromStart(startStr, minutes) {
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m < 1 || m > 24 * 60) return null;
  if (!/^\d{1,2}:\d{2}/.test(String(startStr))) return null;
  return shiftTime(startStr, m);
}

/** 结束=现在、往前推 minutes：{ dateStr, startStr, endStr }；时长非法返回 null。 */
export function deriveFromEnd(now, minutes) {
  const endStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const r = startFromEnd(endStr, today, minutes);
  return r ? { ...r, endStr } : null;
}

/** 三个时间字段里哪些由系统填：两个时间都有值时，没亲手填的那个（都填过则时长）。 */
function autoFieldsFor(start, end, typed) {
  if (!start || !end) return [];
  if (typed.length === 0) return ['start', 'end'];
  if (typed.length === 1) return [typed[0] === 'start' ? 'end' : 'start'];
  return ['minutes'];
}

/**
 * 时间行（开始 · 时长 · 结束）的唯一推演规则，界面不得另写一套。
 * current: { start: 'HH:MM'|'', end: 'HH:MM'|'', minutes: number|null, typed: Array<'start'|'end'>（由早到晚，最多 2 个）}
 * edited:  { field: 'start'|'end'|'minutes'|'nowStart'|'nowEnd', value?, now?: Date }
 * 返回 { start, end, minutes, typed, auto }（auto = 本次由系统填的字段）。
 */
export function resolveTimes(current, edited) {
  const cur = current || {};
  const ed = edited || {};
  let start = String(cur.start || '');
  let end = String(cur.end || '');
  let typed = Array.isArray(cur.typed) ? cur.typed.filter(t => t === 'start' || t === 'end').slice(-2) : [];
  const now = ed.now instanceof Date && !Number.isNaN(ed.now.getTime()) ? ed.now : new Date();
  const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const field = ed.field;

  if (field === 'start' || field === 'end' || field === 'nowStart' || field === 'nowEnd') {
    const which = (field === 'start' || field === 'nowStart') ? 'start' : 'end';
    const v = (field === 'nowStart' || field === 'nowEnd') ? nowStr : String(ed.value || '');
    if (which === 'start') start = v; else end = v;
    // 亲手填的（含点「现在」）记为 typed，清空则不再算填过
    typed = [...typed.filter(t => t !== which), ...(v ? [which] : [])];
  } else if (field === 'minutes') {
    const minutes = Math.round(Number(ed.value));
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60) {
      // 最近亲手填的那个时间不动，另一个按时长推算；都没填过则以结束（=现在）为准
      const anchor = durationAnchor([...typed].reverse());
      if (anchor === 'start' && start) {
        const nextEnd = endFromStart(start, minutes);
        if (nextEnd) { end = nextEnd; typed = ['start']; }
      } else {
        const base = end || nowStr;
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const r = startFromEnd(base, todayStr, minutes);
        // 让位的时间不再算亲手填过；什么都没填过时两个时间都是系统推的
        if (r) { start = r.startStr; end = base; typed = typed.includes('end') ? ['end'] : []; }
      }
    }
  }

  return { start, end, minutes: computeDuration(start, end), typed, auto: autoFieldsFor(start, end, typed) };
}

/** 结束 <= 开始（HH:MM[:SS]）即跨午夜。 */
export function spansMidnight(startTime, endTime) {
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  return mins(endTime) <= mins(startTime);
}

/**
 * 在 rows 里找与 target 时段重叠的第一条（跨午夜的记录按 次日结束 计算，首尾相接不算重叠）。
 * target / rows 用 session_date + start_time + end_time；excludeId 为编辑中的记录。
 * 只在跨午夜时使用：普通同日时段仍走数据库的 lt/gt 查询。
 */
export function findOverlap(rows, target, excludeId = null) {
  const span = (r) => {
    if (!r || !r.session_date || !r.start_time || !r.end_time) return null;
    const [y, mo, d] = String(r.session_date).slice(0, 10).split('-').map(Number);
    const base = Math.round(Date.UTC(y, mo - 1, d) / 60000);
    const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
    const start = base + mins(r.start_time);
    let end = base + mins(r.end_time);
    if (end <= start) end += 24 * 60;
    return [start, end];
  };
  const mine = span(target);
  if (!mine) return null;
  for (const r of rows || []) {
    if (!r || (excludeId && r.id === excludeId) || r.deleted_at) continue;
    const other = span(r);
    if (other && mine[0] < other[1] && other[0] < mine[1]) return r;
  }
  return null;
}

/** 表单校验，返回 { course?, time?, form? }（空对象 = 通过）。文案与改版前一致。 */
export function validateSession({ courseId, startStr, endStr, formValue }) {
  const errors = {};
  if (!courseId) errors.course = '请选择课程';
  if (!startStr || !endStr) errors.time = '请填写开始和结束时间';
  if (!formValue) errors.form = '请选择学习行为形式';
  const duration = computeDuration(startStr, endStr);
  if ((startStr && endStr) && (!duration || duration <= 0)) {
    errors.time = '结束时间需晚于开始时间';
  }
  return errors;
}

/** 客观评价 → grade_label。非练习恒为 null。 */
export function gradeLabelFor({ category, objDeferred, isObjNA, objIdx }) {
  return category === 3
    ? (isObjNA ? 'N/A' : (!objDeferred && objIdx !== null ? OBJECTIVE_STEPS[objIdx].label : null))
    : null;
}

/** 是否保存了客观值（含 N/A）→ eval_type 2，否则 1。 */
export function evalTypeFor({ category, objDeferred, isObjNA, objIdx }) {
  const hasObjective = category === 3 && !objDeferred && (isObjNA || objIdx !== null);
  return hasObjective ? 2 : 1;  // 1=仅主观 / 2=含客观 (含 N/A)
}

/**
 * 组装 learning_sessions 写入 payload。
 * 传 studentId 时带 student_id（新增）；编辑时不传（update 不改归属）。
 */
export function buildSessionPayload(input) {
  const {
    studentId, courseId, chapterId, unitId, category, formValue, notes,
    dateStr, startStr, endStr, subjIdx, objIdx, objDeferred, isObjNA,
  } = input;
  const evalInput = { category, objDeferred, isObjNA, objIdx };
  const payload = {
    course_id: courseId,
    chapter_id: chapterId || null,
    unit_id: unitId || null,
    category,
    form: formValue,
    eval_type: evalTypeFor(evalInput),
    duration_minutes: computeDuration(startStr, endStr),
    notes: (notes || '').trim() || null,
    session_date: dateStr,
    start_time: startStr + ':00',
    end_time: endStr + ':00',
    self_rating: SUBJECTIVE_STEPS[subjIdx].value,  // 始终写入
    grade_label: gradeLabelFor(evalInput),
  };
  return studentId !== undefined ? { student_id: studentId, ...payload } : payload;
}

/**
 * 编辑现有记录时，评价相关表单状态的回显。
 * 客观按 grade_label 存在性独立回显（不依赖 eval_type）；
 * 原本无客观评价时默认「稍后补充」，避免保存时注入默认 B+。
 */
export function evalStateFromRow(row) {
  const subjIdxLoaded = SUBJECTIVE_STEPS.findIndex(s => s.value === row.self_rating);
  const subjIdx = subjIdxLoaded >= 0 ? subjIdxLoaded : DEFAULT_SUBJ_IDX;
  const editHadGrade = !!row.grade_label;
  if (row.grade_label === 'N/A') {
    return { subjIdx, objIdx: DEFAULT_OBJ_IDX, objDeferred: false, isObjNA: true, editHadGrade };
  }
  if (row.grade_label) {
    const objIdxLoaded = OBJECTIVE_STEPS.findIndex(s => s.label === row.grade_label);
    return {
      subjIdx,
      objIdx: objIdxLoaded >= 0 ? objIdxLoaded : DEFAULT_OBJ_IDX,
      objDeferred: false, isObjNA: false, editHadGrade,
    };
  }
  return { subjIdx, objIdx: DEFAULT_OBJ_IDX, objDeferred: true, isObjNA: false, editHadGrade };
}

/** 编辑一条原本有客观评价的记录并切到「稍后补充」时，需提示会清除原有客观评价。 */
export const CLEAR_GRADE_WARNING = '保存后将清除原有客观评价，记录回到待补填。';
export function shouldWarnClearGrade({ editing, editHadGrade, objDeferred, category }) {
  return !!(editing && editHadGrade && objDeferred && category === 3);
}

/** 待补填：练习 + 无 letter grade + 无分数 + 未删除。 */
export function isPendingObjective(row) {
  return !!row
    && row.category === 3
    && row.grade_label == null
    && row.score == null
    && row.deleted_at == null;
}

/** 在 supabase 查询上叠加待补填条件（与 isPendingObjective 同口径）。 */
export function applyPendingFilter(query) {
  return query
    .eq('category', 3)            // 练习
    .is('grade_label', null)      // 无 letter grade
    .is('score', null)            // 也无分数（排除旧 seed 数据）
    .is('deleted_at', null);
}

/** 待补填补一个客观评价时的 update payload。 */
export function pendingGradePayload(gradeLabel) {
  return { grade_label: gradeLabel, eval_type: 2 };  // 含客观
}

/* ---------- 录入默认值（只影响预填，不影响保存口径） ---------- */

/** 课程按最近记录排序：最近记过的在前，其余保持原顺序。 */
export function orderCoursesByRecent(courses, recent) {
  const seen = [];
  for (const r of recent || []) {
    if (r.course_id && !seen.includes(r.course_id)) seen.push(r.course_id);
  }
  const byId = new Map((courses || []).map(c => [c.id, c]));
  const head = seen.map(id => byId.get(id)).filter(Boolean);
  const rest = (courses || []).filter(c => !seen.includes(c.id));
  return [...head, ...rest];
}

/**
 * 某课程默认的章节/单元：优先该课程最近一条记录的位置（且仍存在），
 * 否则沿用改版前的行为——第一个章节 + 其第一个单元。
 */
export function defaultChapterUnit(course, recent) {
  if (!course) return { chapterId: '', unitId: '' };
  const chapters = course.chapters || [];
  const last = (recent || []).find(r => r.course_id === course.id && r.chapter_id);
  if (last) {
    const ch = chapters.find(c => c.id === last.chapter_id);
    if (ch) {
      const un = (ch.units || []).find(u => u.id === last.unit_id);
      return { chapterId: ch.id, unitId: un ? un.id : '' };
    }
  }
  const first = chapters[0];
  if (!first) return { chapterId: '', unitId: '' };
  return { chapterId: first.id, unitId: first.units?.[0]?.id || '' };
}

/**
 * 「再记一次」：从学生自己最近的记录里取不重复的 课程+类别+形式+时长 组合（新的在前）。
 * 返回 { key, courseId, courseName, chapterId, unitId, category, form, durationMinutes }。
 */
export function recentCombos(recent, limit = 4) {
  const out = [];
  const keys = new Set();
  for (const r of recent || []) {
    if (!r.course_id || !r.category || !r.form || !(r.duration_minutes > 0)) continue;
    const key = `${r.course_id}|${r.category}|${r.form}|${r.duration_minutes}`;
    if (keys.has(key)) continue;
    keys.add(key);
    out.push({
      key,
      courseId: r.course_id,
      courseName: r.course?.name || '',
      chapterId: r.chapter_id || '',
      unitId: r.unit_id || '',
      category: r.category,
      form: r.form,
      durationMinutes: r.duration_minutes,
    });
    if (out.length >= limit) break;
  }
  return out;
}
