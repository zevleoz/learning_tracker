import {
  OBJECTIVE_STEPS, GRADE_RANGES, FORM_PRESET_BY_CATEGORY, DEFAULT_EVAL_STATE,
  computeDuration, shiftTime, validateSession, gradeLabelFor, evalTypeFor,
  buildSessionPayload, evalStateFromRow, shouldWarnClearGrade, CLEAR_GRADE_WARNING,
  isPendingObjective, applyPendingFilter, pendingGradePayload,
  orderCoursesByRecent, defaultChapterUnit, recentCombos, durationAnchor, endFromStart,
  parseTimeShorthand,
} from '../src/lib/sessionRules.js';
import { SUBJECTIVE_STEPS } from '../src/lib/rating.js';

// ---- 改版前 Learning.jsx 内联逻辑的逐字副本（对照基准，勿改） ----
function legacyComputeDuration(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  if ([sh,sm,eh,em].some(Number.isNaN)) return null;
  let mins = (eh*60+em) - (sh*60+sm);
  if (mins <= 0) mins += 24*60;
  return mins;
}
function legacyPayload(s, { withStudent }) {
  const duration = legacyComputeDuration(s.startStr, s.endStr);
  const hasObjective = s.category === 3 && !s.objDeferred && (s.isObjNA || s.objIdx !== null);
  const gradeLabelValue = s.category === 3
    ? (s.isObjNA ? 'N/A' : (!s.objDeferred && s.objIdx !== null ? OBJECTIVE_STEPS[s.objIdx].label : null))
    : null;
  const payload = {
    ...(withStudent ? { student_id: s.studentId } : {}),
    course_id: s.courseId,
    chapter_id: s.chapterId || null,
    unit_id: s.unitId || null,
    category: s.category,
    form: s.formValue,
    eval_type: hasObjective ? 2 : 1,
    duration_minutes: duration,
    notes: s.notes.trim() || null,
    session_date: s.dateStr,
    start_time: s.startStr + ':00',
    end_time: s.endStr + ':00',
    self_rating: SUBJECTIVE_STEPS[s.subjIdx].value,
    grade_label: gradeLabelValue,
  };
  return payload;
}
function legacyEditState(r) {
  const out = { editHadGrade: !!r.grade_label };
  const subjIdxLoaded = SUBJECTIVE_STEPS.findIndex(s => s.value === r.self_rating);
  out.subjIdx = subjIdxLoaded >= 0 ? subjIdxLoaded : 3;
  if (r.grade_label === 'N/A') {
    Object.assign(out, { isObjNA: true, objIdx: 9, objDeferred: false });
  } else if (r.grade_label) {
    const objIdxLoaded = OBJECTIVE_STEPS.findIndex(s => s.label === r.grade_label);
    Object.assign(out, { isObjNA: false, objIdx: objIdxLoaded >= 0 ? objIdxLoaded : 9, objDeferred: false });
  } else {
    Object.assign(out, { isObjNA: false, objIdx: 9, objDeferred: true });
  }
  return out;
}
// -----------------------------------------------------------------

const BASE = {
  studentId: 'u1', courseId: 'c1', chapterId: 'ch1', unitId: 'un1',
  category: 1, formValue: '自主预习', notes: '  ', dateStr: '2026-10-25',
  startStr: '09:00', endStr: '10:00',
  subjIdx: 3, objIdx: 9, objDeferred: false, isObjNA: false,
};

describe('sessionRules · 与改版前逐字一致', () => {
  const matrix = [];
  for (const category of [1, 2, 3]) {
    for (const objDeferred of [false, true]) {
      for (const isObjNA of [false, true]) {
        for (const objIdx of [null, 0, 9, 12]) {
          for (const subjIdx of [0, 3, 4]) {
            matrix.push({ ...BASE, category, objDeferred, isObjNA, objIdx, subjIdx });
          }
        }
      }
    }
  }
  matrix.push({ ...BASE, chapterId: '', unitId: '', notes: ' 备注 ', startStr: '23:00', endStr: '01:00' });

  test.each(matrix.map((m, i) => [i, m]))('insert payload #%i', (_i, s) => {
    expect(buildSessionPayload(s)).toEqual(legacyPayload(s, { withStudent: true }));
  });

  test.each(matrix.map((m, i) => [i, m]))('update payload #%i（不带 student_id）', (_i, s) => {
    const { studentId, ...rest } = s; // eslint-disable-line no-unused-vars
    const out = buildSessionPayload(rest);
    expect(out).toEqual(legacyPayload(s, { withStudent: false }));
    expect(out).not.toHaveProperty('student_id');
  });

  test('payload 字段顺序与列集合不变', () => {
    expect(Object.keys(buildSessionPayload(BASE))).toEqual([
      'student_id', 'course_id', 'chapter_id', 'unit_id', 'category', 'form', 'eval_type',
      'duration_minutes', 'notes', 'session_date', 'start_time', 'end_time', 'self_rating', 'grade_label',
    ]);
  });

  const rows = [
    { self_rating: 80, grade_label: null },
    { self_rating: 20, grade_label: 'N/A' },
    { self_rating: 100, grade_label: 'A-' },
    { self_rating: 55, grade_label: 'Z' },
    { self_rating: undefined, grade_label: undefined },
    { self_rating: 40, grade_label: 'F' },
  ];
  test.each(rows)('编辑回显 %o', (r) => {
    expect(evalStateFromRow(r)).toEqual(legacyEditState(r));
  });

  test('computeDuration 与改版前一致', () => {
    const pairs = [['09:00', '10:00'], ['23:00', '01:00'], ['10:00', '10:00'], ['', '10:00'], ['ab', '10:00'], ['09:15', '09:40']];
    for (const [a, b] of pairs) expect(computeDuration(a, b)).toBe(legacyComputeDuration(a, b));
  });
});

describe('sessionRules · 主观评价', () => {
  test('默认基本掌握 80，始终写入 self_rating', () => {
    expect(DEFAULT_EVAL_STATE.subjIdx).toBe(3);
    expect(SUBJECTIVE_STEPS[DEFAULT_EVAL_STATE.subjIdx]).toEqual({ value: 80, label: '基本掌握' });
    for (const category of [1, 2, 3]) {
      expect(buildSessionPayload({ ...BASE, category }).self_rating).toBe(80);
    }
    expect(buildSessionPayload({ ...BASE, subjIdx: 0 }).self_rating).toBe(20);
    expect(buildSessionPayload({ ...BASE, subjIdx: 4 }).self_rating).toBe(100);
  });
});

describe('sessionRules · 客观评价', () => {
  test('13 档 F…A+，默认 B+', () => {
    expect(OBJECTIVE_STEPS.map(s => s.label)).toEqual(['F','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+']);
    expect(OBJECTIVE_STEPS[DEFAULT_EVAL_STATE.objIdx].label).toBe('B+');
    expect(Object.keys(GRADE_RANGES)).toHaveLength(13);
  });

  test('练习 · 现在填写：写入等第，eval_type 2', () => {
    const p = buildSessionPayload({ ...BASE, category: 3 });
    expect(p.grade_label).toBe('B+');
    expect(p.eval_type).toBe(2);
  });

  test('练习 · 稍后补充：grade_label null，eval_type 1，进入待补填', () => {
    const p = buildSessionPayload({ ...BASE, category: 3, objDeferred: true });
    expect(p.grade_label).toBeNull();
    expect(p.eval_type).toBe(1);
    expect(isPendingObjective({ ...p, score: null, deleted_at: null })).toBe(true);
  });

  test('练习 · N/A：grade_label N/A，eval_type 2，不进待补填', () => {
    const p = buildSessionPayload({ ...BASE, category: 3, isObjNA: true });
    expect(p.grade_label).toBe('N/A');
    expect(p.eval_type).toBe(2);
    expect(isPendingObjective({ ...p, score: null, deleted_at: null })).toBe(false);
  });

  test('非练习：grade_label 恒为 null，eval_type 1', () => {
    for (const category of [1, 2]) {
      for (const st of [{}, { isObjNA: true }, { objDeferred: true }]) {
        const p = buildSessionPayload({ ...BASE, category, ...st });
        expect(p.grade_label).toBeNull();
        expect(p.eval_type).toBe(1);
      }
    }
    expect(gradeLabelFor({ category: 1, isObjNA: true, objDeferred: false, objIdx: 9 })).toBeNull();
    expect(evalTypeFor({ category: 2, isObjNA: true, objDeferred: false, objIdx: 9 })).toBe(1);
  });

  test('编辑：原有等第的记录切到稍后补充 → 清除等第 + 提示', () => {
    const row = { category: 3, self_rating: 60, grade_label: 'A' };
    const ev = evalStateFromRow(row);
    expect(ev).toMatchObject({ objIdx: 11, objDeferred: false, isObjNA: false, editHadGrade: true });
    const p = buildSessionPayload({ ...BASE, category: 3, ...ev, objDeferred: true });
    expect(p.grade_label).toBeNull();
    expect(p.eval_type).toBe(1);
    expect(shouldWarnClearGrade({ editing: true, editHadGrade: true, objDeferred: true, category: 3 })).toBe(true);
    expect(shouldWarnClearGrade({ editing: false, editHadGrade: true, objDeferred: true, category: 3 })).toBe(false);
    expect(shouldWarnClearGrade({ editing: true, editHadGrade: false, objDeferred: true, category: 3 })).toBe(false);
    expect(CLEAR_GRADE_WARNING).toBe('保存后将清除原有客观评价，记录回到待补填。');
  });

  test('编辑：原本无客观评价 → 默认稍后补充（不注入 B+）', () => {
    const ev = evalStateFromRow({ category: 3, self_rating: 80, grade_label: null });
    expect(ev.objDeferred).toBe(true);
    expect(buildSessionPayload({ ...BASE, category: 3, ...ev }).grade_label).toBeNull();
  });
});

describe('sessionRules · 待补填', () => {
  const base = { category: 3, grade_label: null, score: null, deleted_at: null };
  test('isPendingObjective', () => {
    expect(isPendingObjective(base)).toBe(true);
    expect(isPendingObjective({ ...base, category: 1 })).toBe(false);
    expect(isPendingObjective({ ...base, grade_label: 'B' })).toBe(false);
    expect(isPendingObjective({ ...base, grade_label: 'N/A' })).toBe(false);
    expect(isPendingObjective({ ...base, score: 88 })).toBe(false);
    expect(isPendingObjective({ ...base, deleted_at: '2026-10-01' })).toBe(false);
    expect(isPendingObjective(null)).toBe(false);
  });

  test('applyPendingFilter 叠加同口径条件', () => {
    const calls = [];
    const q = {
      eq(...a) { calls.push(['eq', ...a]); return q; },
      is(...a) { calls.push(['is', ...a]); return q; },
    };
    expect(applyPendingFilter(q)).toBe(q);
    expect(calls).toEqual([
      ['eq', 'category', 3], ['is', 'grade_label', null], ['is', 'score', null], ['is', 'deleted_at', null],
    ]);
  });

  test('补填 payload', () => {
    expect(pendingGradePayload('A-')).toEqual({ grade_label: 'A-', eval_type: 2 });
  });
});

describe('sessionRules · 其他', () => {
  test('validateSession 文案', () => {
    expect(validateSession({ courseId: '', startStr: '09:00', endStr: '', formValue: '' })).toEqual({
      course: '请选择课程', time: '请填写开始和结束时间', form: '请选择学习行为形式',
    });
    expect(validateSession({ courseId: 'c', startStr: '09:00', endStr: '10:00', formValue: 'x' })).toEqual({});
  });
  test('shiftTime 跨午夜', () => {
    expect(shiftTime('23:30', 45)).toBe('00:15');
    expect(shiftTime('00:10', -25)).toBe('23:45');
    expect(shiftTime('09:00', 60)).toBe('10:00');
  });
  test('形式预设不变', () => {
    expect(FORM_PRESET_BY_CATEGORY[3]).toEqual(['自主练习', '校外线上', '校外线下', '课外作业', '学校作业']);
  });
});

describe('sessionRules · 录入默认值', () => {
  const courses = [
    { id: 'a', name: 'A', chapters: [{ id: 'a1', units: [{ id: 'a1u1' }, { id: 'a1u2' }] }, { id: 'a2', units: [] }] },
    { id: 'b', name: 'B', chapters: [] },
    { id: 'c', name: 'C' },
  ];
  test('orderCoursesByRecent', () => {
    const recent = [{ course_id: 'c' }, { course_id: 'a' }, { course_id: 'c' }, { course_id: 'gone' }];
    expect(orderCoursesByRecent(courses, recent).map(c => c.id)).toEqual(['c', 'a', 'b']);
    expect(orderCoursesByRecent(courses, []).map(c => c.id)).toEqual(['a', 'b', 'c']);
  });
  test('defaultChapterUnit', () => {
    expect(defaultChapterUnit(courses[0], [])).toEqual({ chapterId: 'a1', unitId: 'a1u1' });
    expect(defaultChapterUnit(courses[0], [{ course_id: 'a', chapter_id: 'a1', unit_id: 'a1u2' }])).toEqual({ chapterId: 'a1', unitId: 'a1u2' });
    expect(defaultChapterUnit(courses[0], [{ course_id: 'a', chapter_id: 'a2', unit_id: null }])).toEqual({ chapterId: 'a2', unitId: '' });
    expect(defaultChapterUnit(courses[0], [{ course_id: 'a', chapter_id: 'deleted' }])).toEqual({ chapterId: 'a1', unitId: 'a1u1' });
    expect(defaultChapterUnit(courses[1], [])).toEqual({ chapterId: '', unitId: '' });
    expect(defaultChapterUnit(undefined, [])).toEqual({ chapterId: '', unitId: '' });
  });
  test('recentCombos 去重、跳过不完整、限量', () => {
    const r = (o) => ({ course_id: 'a', category: 3, form: '自主练习', duration_minutes: 45, course: { name: 'A' }, ...o });
    const recent = [r({}), r({}), r({ duration_minutes: 60 }), r({ form: null }), r({ course_id: 'b', category: 1, form: '自主预习' }), r({ duration_minutes: 0 }), r({ duration_minutes: 90 })];
    const out = recentCombos(recent, 3);
    expect(out.map(x => x.key)).toEqual(['a|3|自主练习|45', 'a|3|自主练习|60', 'b|1|自主预习|45']);
    expect(out[0]).toMatchObject({ courseId: 'a', courseName: 'A', category: 3, form: '自主练习', durationMinutes: 45 });
  });
});

describe('时长优先 · deriveFromEnd（结束=现在，往前推开始）', () => {
  // eslint-disable-next-line global-require
  const { deriveFromEnd } = require('../src/lib/sessionRules.js');

  test('不跨午夜：日期为今天', () => {
    expect(deriveFromEnd(new Date(2026, 9, 26, 10, 30), 45))
      .toEqual({ dateStr: '2026-10-26', startStr: '09:45', endStr: '10:30' });
  });

  test('00:20 + 45 分钟：开始 23:35 属于前一天（session_date 取开始所在日），时长仍是 45', () => {
    const r = deriveFromEnd(new Date(2026, 9, 26, 0, 20), 45);
    expect(r).toEqual({ dateStr: '2026-10-25', startStr: '23:35', endStr: '00:20' });
    expect(computeDuration(r.startStr, r.endStr)).toBe(45);
  });

  test('跨月 / 跨年', () => {
    expect(deriveFromEnd(new Date(2026, 10, 1, 0, 10), 30).dateStr).toBe('2026-10-31');
    expect(deriveFromEnd(new Date(2027, 0, 1, 0, 10), 30).dateStr).toBe('2026-12-31');
  });

  test('非法时长返回 null（NaN / Infinity / 0 / 负数 / 超过 24 小时）', () => {
    const now = new Date(2026, 9, 26, 10, 0);
    for (const m of [NaN, Infinity, 0, -5, 1441, 1e9, 'abc', undefined]) {
      expect(deriveFromEnd(now, m)).toBeNull();
    }
  });
});

describe('findOverlap · 跨午夜时段重叠', () => {
  // eslint-disable-next-line global-require
  const { findOverlap, spansMidnight } = require('../src/lib/sessionRules.js');
  const row = (id, d, s, e) => ({ id, session_date: d, start_time: s, end_time: e });
  const mine = { session_date: '2026-10-25', start_time: '23:35:00', end_time: '00:20:00' };

  test('spansMidnight：结束 <= 开始', () => {
    expect(spansMidnight('23:35:00', '00:20:00')).toBe(true);
    expect(spansMidnight('09:00:00', '10:00:00')).toBe(false);
  });

  test('同一晚已有 23:00–23:50：重叠', () => {
    expect(findOverlap([row('a', '2026-10-25', '23:00:00', '23:50:00')], mine).id).toBe('a');
  });

  test('次日凌晨已有 00:00–00:30：重叠', () => {
    expect(findOverlap([row('a', '2026-10-26', '00:00:00', '00:30:00')], mine).id).toBe('a');
  });

  test('已有同样的跨午夜记录：重叠', () => {
    expect(findOverlap([row('a', '2026-10-25', '23:35:00', '00:20:00')], mine).id).toBe('a');
  });

  test('前一晚的跨午夜记录延伸到当天凌晨：与当天 00:10 开始的记录重叠', () => {
    const cur = { session_date: '2026-10-26', start_time: '00:10:00', end_time: '00:50:00' };
    expect(findOverlap([row('a', '2026-10-25', '23:35:00', '00:20:00')], cur).id).toBe('a');
  });

  test('不重叠、首尾相接、排除自身', () => {
    expect(findOverlap([row('a', '2026-10-25', '22:00:00', '23:35:00')], mine)).toBeNull();
    expect(findOverlap([row('a', '2026-10-26', '00:20:00', '01:00:00')], mine)).toBeNull();
    expect(findOverlap([row('a', '2026-10-25', '23:35:00', '00:20:00')], mine, 'a')).toBeNull();
  });

  test('缺时间的旧行跳过', () => {
    expect(findOverlap([row('a', '2026-10-25', null, null)], mine)).toBeNull();
  });
});

describe('resolveTimes · 开始 / 时长 / 结束 的推演', () => {
  // eslint-disable-next-line global-require
  const { resolveTimes } = require('../src/lib/sessionRules.js');
  const NOW = new Date(2026, 9, 26, 10, 30);
  const cur = (o = {}) => ({ start: '', end: '', minutes: null, typed: [], ...o });

  test('填开始 14:00 再选 45 → 结束 14:45（自动）', () => {
    let r = resolveTimes(cur(), { field: 'start', value: '14:00' });
    expect(r).toMatchObject({ start: '14:00', end: '', minutes: null, typed: ['start'], auto: [] });
    r = resolveTimes(r, { field: 'minutes', value: 45, now: NOW });
    expect(r).toMatchObject({ start: '14:00', end: '14:45', minutes: 45, typed: ['start'], auto: ['end'] });
  });

  test('填结束 16:30 再选 45 → 开始 15:45（自动）', () => {
    let r = resolveTimes(cur(), { field: 'end', value: '16:30' });
    expect(r).toMatchObject({ start: '', end: '16:30', typed: ['end'], auto: [] });
    r = resolveTimes(r, { field: 'minutes', value: 45, now: NOW });
    expect(r).toMatchObject({ start: '15:45', end: '16:30', minutes: 45, typed: ['end'], auto: ['start'] });
  });

  test('什么都没填就选 45 → 结束=现在，开始=现在−45（两个都自动）', () => {
    const r = resolveTimes(cur(), { field: 'minutes', value: 45, now: NOW });
    expect(r).toMatchObject({ start: '09:45', end: '10:30', minutes: 45, typed: [], auto: ['start', 'end'] });
  });

  test('填开始 14:00 和结束 15:10 → 时长 70（自动）', () => {
    let r = resolveTimes(cur(), { field: 'start', value: '14:00' });
    r = resolveTimes(r, { field: 'end', value: '15:10' });
    expect(r).toMatchObject({ start: '14:00', end: '15:10', minutes: 70, typed: ['start', 'end'], auto: ['minutes'] });
  });

  test('填开始 → 选 45 → 再填结束 15:00：时长让位，变成 60', () => {
    let r = resolveTimes(cur(), { field: 'start', value: '14:00' });
    r = resolveTimes(r, { field: 'minutes', value: 45, now: NOW });
    r = resolveTimes(r, { field: 'end', value: '15:00' });
    expect(r).toMatchObject({ start: '14:00', end: '15:00', minutes: 60, typed: ['start', 'end'], auto: ['minutes'] });
  });

  test('填开始 14:00、结束 15:10 再选 45 → 较早填的开始移动，到 14:25', () => {
    let r = resolveTimes(cur(), { field: 'start', value: '14:00' });
    r = resolveTimes(r, { field: 'end', value: '15:10' });
    r = resolveTimes(r, { field: 'minutes', value: 45, now: NOW });
    expect(r).toMatchObject({ start: '14:25', end: '15:10', minutes: 45, typed: ['end'], auto: ['start'] });
  });

  test('点「现在」：该字段=现在，并算亲手填过', () => {
    const r = resolveTimes(cur(), { field: 'nowStart', now: NOW });
    expect(r).toMatchObject({ start: '10:30', end: '', typed: ['start'] });
    const r2 = resolveTimes(cur(), { field: 'nowEnd', now: NOW });
    expect(r2).toMatchObject({ start: '', end: '10:30', typed: ['end'] });
    // 两个都点了「现在」：时长为自动
    const both = resolveTimes(r2, { field: 'nowStart', now: NOW });
    expect(both.typed).toEqual(['end', 'start']);
    expect(both.auto).toEqual(['minutes']);
  });

  test('开始 23:30 + 60 → 结束 00:30（允许跨午夜）', () => {
    let r = resolveTimes(cur(), { field: 'start', value: '23:30' });
    r = resolveTimes(r, { field: 'minutes', value: 60, now: NOW });
    expect(r).toMatchObject({ start: '23:30', end: '00:30', minutes: 60, auto: ['end'] });
    expect(computeDuration(r.start, r.end)).toBe(60);
  });

  test('结束 00:20 选 45 → 开始 23:35（跨午夜往昨天推）', () => {
    let r = resolveTimes(cur(), { field: 'end', value: '00:20' });
    r = resolveTimes(r, { field: 'minutes', value: 45, now: NOW });
    expect(r).toMatchObject({ start: '23:35', end: '00:20', minutes: 45, typed: ['end'], auto: ['start'] });
  });

  test('现在是 00:20、什么都没填选 45：开始 23:35、结束 00:20', () => {
    const midnight = new Date(2026, 9, 26, 0, 20);
    const r = resolveTimes(cur(), { field: 'minutes', value: 45, now: midnight });
    expect(r).toMatchObject({ start: '23:35', end: '00:20', minutes: 45, auto: ['start', 'end'] });
  });

  test('typed 最多 2 个；清空时间不算填过；非法时长不改动', () => {
    let r = resolveTimes(cur({ start: '09:00', end: '10:00', minutes: 60, typed: ['start', 'end'] }), { field: 'start', value: '' });
    expect(r.start).toBe('');
    expect(r.typed).toEqual(['end']);
    expect(r.auto).toEqual([]);
    const before = cur({ start: '09:00', end: '10:00', minutes: 60, typed: ['start', 'end'] });
    for (const v of [0, -5, 1441, NaN, 'abc', '']) {
      const bad = resolveTimes(before, { field: 'minutes', value: v, now: NOW });
      expect(bad.start).toBe('09:00');
      expect(bad.end).toBe('10:00');
      expect(bad.minutes).toBe(60);
    }
  });
});

describe('parseTimeShorthand · 桌面快捷输入', () => {
  test('四位纯数字 → HH:MM；三位按 HMM 补零', () => {
    expect(parseTimeShorthand('1430')).toBe('14:30');
    expect(parseTimeShorthand('930')).toBe('09:30');
    expect(parseTimeShorthand('0015')).toBe('00:15');
  });
  test('冒号写法：一位小时补零，分钟必须两位', () => {
    expect(parseTimeShorthand('14:30')).toBe('14:30');
    expect(parseTimeShorthand('2:30')).toBe('02:30');
    expect(parseTimeShorthand('0:05')).toBe('00:05');
    expect(parseTimeShorthand('2:3')).toBeNull();
  });
  test('非法 / 越界返回 null', () => {
    expect(parseTimeShorthand('2400')).toBeNull();
    expect(parseTimeShorthand('1460')).toBeNull();
    expect(parseTimeShorthand('24:00')).toBeNull();
    expect(parseTimeShorthand('1')).toBeNull();
    expect(parseTimeShorthand('12345')).toBeNull();
    expect(parseTimeShorthand('')).toBeNull();
    expect(parseTimeShorthand('abc')).toBeNull();
    expect(parseTimeShorthand(null)).toBeNull();
  });
  test('首尾空白忽略', () => {
    expect(parseTimeShorthand(' 1430 ')).toBe('14:30');
  });
});

describe('选时长时的基准（durationAnchor / endFromStart）', () => {
  test('没亲手填过时间：以结束（=现在）为准', () => {
    expect(durationAnchor([])).toBe('end');
    expect(durationAnchor(undefined)).toBe('end');
  });
  test('最近亲手填的那个时间保持不动', () => {
    expect(durationAnchor(['start'])).toBe('start');
    expect(durationAnchor(['end', 'start'])).toBe('end');
    expect(durationAnchor(['start', 'end'])).toBe('start');
  });
  test('开始往后推；跨午夜按 24 小时取模', () => {
    expect(endFromStart('14:00', 45)).toBe('14:45');
    expect(endFromStart('23:30', 60)).toBe('00:30');
  });
  test('非法时长 / 时间返回 null', () => {
    expect(endFromStart('14:00', 0)).toBeNull();
    expect(endFromStart('14:00', 1441)).toBeNull();
    expect(endFromStart('14:00', 'abc')).toBeNull();
    expect(endFromStart('', 30)).toBeNull();
  });
});
