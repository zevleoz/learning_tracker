import { extractCarry, buildProgressDraft } from '../src/lib/e4ProgressTemplate.js';

// BUG-3：第二份起的过程报告「上阶段承接」为空，因为只认 first 报告的 section07 形状。
describe('extractCarry（上阶段承接，按上期报告类型分派）', () => {
  it('上期是 first 报告：读 section07', () => {
    const prior = {
      report_type: 'first',
      form_data: {
        section07: {
          nextReviewFocus: '作业拖延与启动困难',
          solutions: [{ direction: '先做 15 分钟启动' }, { direction: '固定作息' }, { direction: '' }],
        },
      },
    };
    expect(extractCarry(prior)).toEqual({
      priorIssues: '作业拖延与启动困难',
      priorDirection: '先做 15 分钟启动；固定作息',
    });
  });

  it('上期是 progress 报告：读 p8（此前恒为空）', () => {
    const prior = {
      report_type: 'progress',
      form_data: {
        p8: {
          goal1: '稳定每日复习节奏',
          goal2: '提高练习一次通过率',
          solutions: [{ direction: '复习改为错题优先' }, { direction: '练习后立即自评' }],
          reviewDate: '2026-12-15',
        },
      },
    };
    expect(extractCarry(prior)).toEqual({
      priorIssues: '稳定每日复习节奏；提高练习一次通过率',
      priorDirection: '复习改为错题优先；练习后立即自评',
    });
  });

  it('progress 报告只有优先目标一时只承接一条', () => {
    const prior = { report_type: 'progress', form_data: { p8: { goal1: '保持节奏', solutions: [] } } };
    expect(extractCarry(prior).priorIssues).toBe('保持节奏');
  });

  it('缺失数据返回空串，不抛异常', () => {
    expect(extractCarry(null)).toEqual({ priorIssues: '', priorDirection: '' });
    expect(extractCarry({ report_type: 'progress' })).toEqual({ priorIssues: '', priorDirection: '' });
    expect(extractCarry({ report_type: 'first', form_data: {} })).toEqual({ priorIssues: '', priorDirection: '' });
  });
});

describe('buildProgressDraft 承接写入', () => {
  it('carry 写入 p2 的上阶段字段', () => {
    const draft = buildProgressDraft(
      { period: { start: '2026-03-01', end: '2026-03-31', totalDays: 31 }, summary: {}, calendar: {}, subjects: [] },
      { display_name: 'Leo' },
      { issueNumber: 2, reportDate: '2026-03-31', periodStart: '2026-03-01', periodEnd: '2026-03-31', carry: extractCarry({ report_type: 'progress', form_data: { p8: { goal1: 'G1', solutions: [{ direction: 'D1' }] } } }) }
    );
    expect(draft.cover.issueNumber).toBe('第 2 期');
    expect(draft.p2.priorIssues).toBe('G1');
    expect(draft.p2.priorDirection).toBe('D1');
    expect(draft.p8.reviewDate).toBe('');
  });
});