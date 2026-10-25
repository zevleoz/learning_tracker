import {
  isReportDue, groupKeyForStudent, groupStudents, reportActionFor,
  filterByScope, loadScope, saveScope, meetingCell, nextStepFor, relativeDayText,
} from '../src/lib/e4Todos.js';

const iso = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 某天中午的 ISO 时间戳（本地时间）
const at = (offset) => new Date(`${iso(offset)}T12:00:00`).toISOString();
const stu = (over) => ({ id: 's1', next_meeting_type: 'first', next_meeting_date: null, latest_report_at: null, ...over });

describe('isReportDue（待写报告）', () => {
  it('过去的会议没有任何报告 → 待写（first 与 progress 同样适用）', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(-4), next_meeting_type: 'first' }))).toBe(true);
    expect(isReportDue(stu({ next_meeting_date: iso(-4), next_meeting_type: 'progress' }))).toBe(true);
  });

  it('会议日期之后出过报告 → 不再待写；之前的旧报告不算', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(-4), latest_report_at: at(-2) }))).toBe(false);
    expect(isReportDue(stu({ next_meeting_date: iso(-4), latest_report_at: at(-10) }))).toBe(true);
  });

  it('报告创建于会议当天算「当天或之后」', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(-4), latest_report_at: at(-4) }))).toBe(false);
    expect(isReportDue(stu({ next_meeting_date: iso(-4), latest_report_at: iso(-4) }))).toBe(false);
  });

  it('今天的会议留在「今天」，第二天起才待写', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(0) }))).toBe(false);
    expect(isReportDue(stu({ next_meeting_date: iso(-1) }))).toBe(true);
    expect(isReportDue(stu({ next_meeting_date: iso(0), latest_report_at: at(0) }))).toBe(false);
  });

  it('未来会议与无日期 → 不待写', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(1) }))).toBe(false);
    expect(isReportDue(stu({ next_meeting_date: null }))).toBe(false);
  });

  it('日期范围以起始日为准：起始日已到、结束日在未来仍待写', () => {
    expect(isReportDue(stu({ next_meeting_date: iso(-1), next_meeting_end_date: iso(2) }))).toBe(true);
    expect(isReportDue(stu({ next_meeting_date: iso(1), next_meeting_end_date: iso(3) }))).toBe(false);
  });
});

describe('groupStudents（分组与顺序）', () => {
  it('待写报告 → 今天 → 未来 7 天 → 之后 → 待安排', () => {
    const rows = [
      stu({ id: 'none' }),
      stu({ id: 'later', next_meeting_date: iso(20) }),
      stu({ id: 'week', next_meeting_date: iso(3), next_meeting_end_date: iso(5) }),
      stu({ id: 'today', next_meeting_date: iso(0), latest_report_at: at(0) }),
      stu({ id: 'due', next_meeting_date: iso(-4) }),
    ];
    const groups = groupStudents(rows);
    expect(groups.map((g) => g.key)).toEqual(['report', 'today', 'week', 'later', 'unscheduled']);
    expect(groups.map((g) => g.rows[0].id)).toEqual(['due', 'today', 'week', 'later', 'none']);
    expect(groups[0].title).toBe('待写报告');
  });

  it('日期已过但之后出过报告 → 没有下一场会议，仍归待安排；空分组不出现', () => {
    const rows = [stu({ id: 'done', next_meeting_date: iso(-4), latest_report_at: at(-1) })];
    expect(groupKeyForStudent(rows[0])).toBe('unscheduled');
    expect(groupStudents(rows)).toHaveLength(1);
    expect(groupStudents([])).toEqual([]);
  });
});

describe('reportActionFor（待写报告主操作）', () => {
  it('首次 / 过程中按类型给出文案与新建路径', () => {
    expect(reportActionFor(stu({ id: 'a' }))).toEqual({ label: '填写首次会议记录报告', path: '/e4/students/a/new-first' });
    expect(reportActionFor(stu({ id: 'a', next_meeting_type: 'progress' })))
      .toEqual({ label: '填写过程中报告', path: '/e4/students/a/new-progress' });
  });

  it('已有同类草稿时回到草稿', () => {
    expect(reportActionFor(stu({ id: 'a', draft_first_id: 'r1' })).path).toBe('/e4/reports/r1/build');
    expect(reportActionFor(stu({ id: 'a', next_meeting_type: 'progress', draft_progress_id: 'r2' })).path).toBe('/e4/progress/r2');
  });
});

describe('我的 / 全部', () => {
  const rows = [
    { id: 1, advisor_id: 'me' },
    { id: 2, advisor_id: 'other' },
    { id: 3, advisor_id: null },
  ];

  it('我的 = advisor_id 等于当前用户；全部不过滤', () => {
    expect(filterByScope(rows, 'mine', 'me').map((r) => r.id)).toEqual([1]);
    expect(filterByScope(rows, 'all', 'me')).toHaveLength(3);
  });

  it('拿不到用户 id 时「我的」为空，不会误显示全部', () => {
    expect(filterByScope(rows, 'mine', undefined)).toEqual([]);
  });

  it('默认我的；选择写入 localStorage，存取失败时降级', () => {
    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
      },
      configurable: true,
    });
    expect(loadScope()).toBe('mine');
    saveScope('all');
    expect(loadScope()).toBe('all');
    saveScope('mine');
    expect(loadScope()).toBe('mine');

    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
      configurable: true,
    });
    expect(loadScope()).toBe('mine');
    expect(() => saveScope('all')).not.toThrow();
  });
});

describe('nextStepFor（学生详情下一步）', () => {
  it('没有会前准备 → 生成会前准备', () => {
    expect(nextStepFor({}, []).key).toBe('prep');
    expect(nextStepFor({}, []).label).toBe('生成会前准备');
  });

  it('有会前准备、没有首次报告 → 生成首次报告', () => {
    expect(nextStepFor({}, [{ report_type: 'prep' }]).key).toBe('first');
  });

  it('首次报告已有 → 生成过程报告；原因一行，随一表人才关联状态变化', () => {
    const reports = [{ report_type: 'first', meeting_date: '2026-09-28' }, { report_type: 'prep' }];
    const linked = nextStepFor({ tracker_profile_id: 't1' }, reports);
    expect(linked.key).toBe('progress');
    expect(linked.label).toBe('生成过程报告');
    expect(linked.reason).toContain('9/28');
    expect(nextStepFor({ tracker_profile_id: null }, reports).reason).toContain('关联一表人才');
  });

  it('没有会前准备但已有首次报告 → 仍是过程报告', () => {
    expect(nextStepFor({}, [{ report_type: 'first' }]).key).toBe('progress');
  });
});

describe('meetingCell / relativeDayText', () => {
  it('待写报告、今天、日期、待安排', () => {
    expect(meetingCell(stu({ next_meeting_date: iso(-4) }))).toMatchObject({ kind: 'due', text: '待写报告' });
    expect(meetingCell(stu({ next_meeting_date: iso(0), latest_report_at: at(0) }))).toMatchObject({ kind: 'today', text: '今天' });
    const future = meetingCell(stu({ next_meeting_date: iso(3), next_meeting_type: 'progress' }));
    expect(future.kind).toBe('date');
    expect(future.type).toBe('进程中');
    expect(meetingCell(stu({ next_meeting_date: null }))).toMatchObject({ kind: 'none', text: '待安排' });
  });

  it('报告信息没取到时不判断待写报告', () => {
    expect(meetingCell(stu({ next_meeting_date: iso(-4) }), false).kind).toBe('date');
  });

  it('相对天数文案', () => {
    expect(relativeDayText(iso(0))).toBe('今天');
    expect(relativeDayText(iso(3))).toBe('3 天后');
    expect(relativeDayText(iso(-5))).toBe('5 天前');
    expect(relativeDayText(null)).toBeNull();
  });
});
