import {
  WINDOW_DAYS,
  daysBetween,
  evaluateInactivity,
  formatInactivity,
} from '../src/utils/inactivity';

const TODAY = '2026-10-13';
const YESTERDAY = '2026-10-12';
const DAY_BEFORE = '2026-10-11';
const WINDOW_START = '2026-10-06';

const stu = (id, created_at = '2024-01-01') => ({ id, created_at });
const ses = (student_id, session_date) => ({ student_id, session_date });

/** 便捷：单学生单场景，返回 inactiveByStudent[sid] */
function judge(sessions, students, opts) {
  return evaluateInactivity(sessions, students, TODAY, opts);
}

describe('evaluateInactivity', () => {
  it('今天与昨天都有记录 → 不提醒', () => {
    const r = judge([ses('s1', TODAY), ses('s1', YESTERDAY)], [stu('s1')]);
    expect(r.inactiveCount).toBe(0);
    expect(r.inactiveByStudent.s1).toBeUndefined();
  });

  it('仅今天有记录 → 不提醒', () => {
    const r = judge([ses('s1', TODAY)], [stu('s1')]);
    expect(r.inactiveCount).toBe(0);
  });

  it('仅昨天有记录 → 不提醒（今天尚未结束）', () => {
    const r = judge([ses('s1', YESTERDAY)], [stu('s1')]);
    expect(r.inactiveCount).toBe(0);
  });

  it('最后记录为前天 → 2 天未填写', () => {
    const r = judge([ses('s1', DAY_BEFORE)], [stu('s1')]);
    expect(r.inactiveByStudent.s1).toEqual({ days: 2, capped: false });
    expect(r.inactiveCount).toBe(1);
    expect(formatInactivity(r.inactiveByStudent.s1)).toBe('2 天未填写');
  });

  it('最后记录为窗口最早日 D-7 → 7 天未填写（精确值，非 capped）', () => {
    const r = judge([ses('s1', WINDOW_START)], [stu('s1')]);
    expect(r.inactiveByStudent.s1).toEqual({ days: WINDOW_DAYS, capped: false });
    expect(formatInactivity(r.inactiveByStudent.s1)).toBe('7 天未填写');
  });

  it('窗口内无记录 + 老账号 → 7 天以上未填写', () => {
    const r = judge([], [stu('s1', '2024-01-01')]);
    expect(r.inactiveByStudent.s1).toEqual({ days: WINDOW_DAYS, capped: true });
    expect(formatInactivity(r.inactiveByStudent.s1)).toBe('7 天以上未填写');
  });

  it('窗口内无记录 + 新账号（创建于窗口内）→ 不提醒', () => {
    const r = judge([], [stu('s1', '2026-10-10')]);
    expect(r.inactiveCount).toBe(0);
  });

  it('created_at 恰为窗口最早日 D-7 → 视为新账号，不提醒（边界）', () => {
    const r = judge([], [stu('s1', WINDOW_START)]);
    expect(r.inactiveCount).toBe(0);
  });

  it('created_at 缺失 → 按老账号处理（capped）', () => {
    const r = judge([], [{ id: 's1' }]);
    expect(r.inactiveByStudent.s1).toEqual({ days: WINDOW_DAYS, capped: true });
  });

  it('session_date 含时间戳时被裁剪为日期', () => {
    const r = judge([ses('s1', `${TODAY}T09:30:00.000Z`)], [stu('s1')]);
    expect(r.lastDateByStudent.s1).toBe(TODAY);
    expect(r.inactiveCount).toBe(0);
  });

  it('同一学生多条记录取最大日期', () => {
    const r = judge(
      [ses('s1', '2026-10-06'), ses('s1', YESTERDAY), ses('s1', '2026-10-09')],
      [stu('s1')],
    );
    expect(r.lastDateByStudent.s1).toBe(YESTERDAY);
    expect(r.inactiveCount).toBe(0);
  });

  it('非目标学生的记录被忽略', () => {
    const r = judge([ses('other', '2026-10-01')], [stu('s1')]);
    expect(r.inactiveCount).toBe(1); // s1 自身仍是老账号断更
    expect(r.inactiveByStudent.other).toBeUndefined();
  });

  it('空入参 → 计数为 0', () => {
    const r = evaluateInactivity([], [], TODAY);
    expect(r.inactiveCount).toBe(0);
    expect(r.inactiveByStudent).toEqual({});
  });

  it('truncated=true 时窗口内无记录的学生不报（避免假阳性）', () => {
    const r = judge([], [stu('s1', '2024-01-01')], { truncated: true });
    expect(r.inactiveCount).toBe(0);
  });

  it('跨月/跨年字符串比较正确', () => {
    const r = evaluateInactivity([ses('s1', '2025-12-30')], [stu('s1')], '2026-01-01');
    expect(r.inactiveByStudent.s1).toEqual({ days: 2, capped: false });
  });
});

describe('daysBetween', () => {
  it('按 UTC 计算天数差，跨月/跨年一致', () => {
    expect(daysBetween('2026-10-11', '2026-10-13')).toBe(2);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-10-13', '2026-10-13')).toBe(0);
  });
});

describe('formatInactivity', () => {
  it('精确天数与 capped 两种文案', () => {
    expect(formatInactivity({ days: 3, capped: false })).toBe('3 天未填写');
    expect(formatInactivity({ days: 7, capped: true })).toBe('7 天以上未填写');
  });
});