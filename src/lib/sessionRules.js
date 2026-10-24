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

/** HH:MM 加减分钟（按 24 小时取模）。 */
export function shiftTime(timeStr, deltaMinutes) {
  const [h, m] = String(timeStr).split(':').map(Number);
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
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
