import {
  OBJECTIVE_STEPS, GRADE_RANGES, FORM_PRESET_BY_CATEGORY, DEFAULT_EVAL_STATE,
  computeDuration, shiftTime, validateSession, gradeLabelFor, evalTypeFor,
  buildSessionPayload, evalStateFromRow, shouldWarnClearGrade, CLEAR_GRADE_WARNING,
  isPendingObjective, applyPendingFilter, pendingGradePayload,
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
