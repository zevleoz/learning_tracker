import { extractPrepMeetingDate, prepMeetingPatch, extractNextReviewDate } from '../src/lib/e4MeetingSync.js';

describe('extractNextReviewDate（BUG-2：按报告类型取字段）', () => {
  it('first 报告读 section07.nextReviewDate', () => {
    expect(extractNextReviewDate('first', { section07: { nextReviewDate: '2026-11-01' } })).toBe('2026-11-01');
  });

  it('first 报告的区间值取起始日', () => {
    expect(extractNextReviewDate('first', { section07: { nextReviewDate: '2026-11-01~2026-11-30' } })).toBe('2026-11-01');
  });

  it('progress 报告读 p8.reviewDate（此前永远取不到，导致待办日期链断裂）', () => {
    expect(extractNextReviewDate('progress', { p8: { reviewDate: '2026-12-15' } })).toBe('2026-12-15');
  });

  it('progress 报告不会误读 first 形状的字段', () => {
    expect(extractNextReviewDate('progress', { section07: { nextReviewDate: '2026-11-01' } })).toBeNull();
  });

  it('缺失或非法值返回 null', () => {
    expect(extractNextReviewDate('progress', {})).toBeNull();
    expect(extractNextReviewDate('progress', null)).toBeNull();
    expect(extractNextReviewDate('first', { section07: { nextReviewDate: '待定' } })).toBeNull();
    expect(extractNextReviewDate('first', { section07: { nextReviewDate: '' } })).toBeNull();
  });
});

describe('extractPrepMeetingDate', () => {
  it('提取合法的会议日期', () => {
    expect(extractPrepMeetingDate({ prepCover: { meetingDate: '2026-10-01' } })).toBe('2026-10-01');
  });

  it('非法或缺失日期返回 null', () => {
    expect(extractPrepMeetingDate({ prepCover: { meetingDate: '2026/10/01' } })).toBeNull();
    expect(extractPrepMeetingDate({ prepCover: { meetingDate: '' } })).toBeNull();
    expect(extractPrepMeetingDate({})).toBeNull();
    expect(extractPrepMeetingDate(null)).toBeNull();
  });
});

describe('prepMeetingPatch', () => {
  const firstStudent = { next_meeting_date: null, next_meeting_type: 'first' };

  it('填入日期后写入 next_meeting_date，保持 first 类型', () => {
    expect(prepMeetingPatch({ prepCover: { meetingDate: '2026-10-05' } }, firstStudent))
      .toEqual({ next_meeting_date: '2026-10-05', next_meeting_type: 'first' });
  });

  it('日期与档案一致时无需更新', () => {
    const s = { next_meeting_date: '2026-10-05', next_meeting_type: 'first' };
    expect(prepMeetingPatch({ prepCover: { meetingDate: '2026-10-05' } }, s)).toBeNull();
  });

  it('日期被清空时回归待安排', () => {
    const s = { next_meeting_date: '2026-10-05', next_meeting_type: 'first' };
    expect(prepMeetingPatch({ prepCover: { meetingDate: '' } }, s))
      .toEqual({ next_meeting_date: null, next_meeting_type: 'first' });
  });

  it('progress 阶段的学生不被会前日期覆盖', () => {
    const s = { next_meeting_date: '2026-11-01', next_meeting_type: 'progress' };
    expect(prepMeetingPatch({ prepCover: { meetingDate: '2026-10-05' } }, s)).toBeNull();
  });

  it('学生不存在时不更新', () => {
    expect(prepMeetingPatch({ prepCover: { meetingDate: '2026-10-05' } }, null)).toBeNull();
  });
});
