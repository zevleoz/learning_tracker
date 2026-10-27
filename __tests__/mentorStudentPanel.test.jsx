import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StudentMessagesPanel from '../src/components/mentor/StudentMessagesPanel';

// WS-4 的 MessageCard 由另一个分支并行开发，这里用只渲染正文的替身。
jest.mock(
  '../src/components/mentor/MessageCard.jsx',
  () => ({
    __esModule: true,
    default: ({ draft }) => <div data-testid="message-card">{draft.edited_body ?? draft.body}</div>,
  }),
  { virtual: true },
);

const at = (y, m, d, h = 9) => new Date(y, m - 1, d, h, 12).toISOString();

const person = {
  id: 's1',
  name: '林小满',
  stageText: '首月 · 第 13 天',
  school: '平和双语',
  consultant: 'Angela',
  mentorName: '陈老师',
};

const draftOf = (over = {}) => ({
  id: 'd1',
  student_id: 's1',
  kind: 'daily',
  period_start: '2026-10-25',
  period_end: '2026-10-25',
  body: '物理斜面那题受力图错了两次。',
  edited_body: null,
  evidence: [],
  status: 'sent',
  handled_by: 'u-me',
  handled_at: at(2026, 10, 23),
  created_at: at(2026, 10, 23),
  snooze_until: null,
  skip_reason: null,
  meta: {},
  ...over,
});

const stubDr = (history = []) => ({
  loadHistory: jest.fn(async () => history),
  handlerName: jest.fn((id) => (id === 'u-me' ? '你' : id ? '李老师' : '')),
});

const renderPanel = (props = {}) => {
  const merged = {
    student: { id: 's1' },
    person,
    draft: null,
    dr: stubDr(),
    todayIso: '2026-10-26',
    showMentor: false,
    ...props,
  };
  return render(<StudentMessagesPanel {...merged} />);
};

describe('学生消息面板 · 今天的消息', () => {
  it('有草稿时渲染卡片正文', async () => {
    const draft = draftOf({ id: 'open', status: 'draft', handled_by: null, handled_at: null, body: '数学导数那节你备注写了例题自己又推了一遍。' });
    renderPanel({ draft, dr: stubDr([]) });

    expect(await screen.findByTestId('message-card')).toHaveTextContent('数学导数那节你备注写了例题自己又推了一遍。');
    expect(screen.queryByText('今天没有要发的消息。')).toBeNull();
    expect(screen.getByText('今天的消息')).toBeInTheDocument();
  });

  it('没有草稿时显示一行说明', async () => {
    renderPanel({ dr: stubDr([draftOf({ id: 'h1' })]) });

    expect(await screen.findByText('今天没有要发的消息。')).toBeInTheDocument();
    expect(screen.queryByTestId('message-card')).toBeNull();
  });
});

describe('学生消息面板 · 发过的消息', () => {
  it('已发消息显示日期、类型、经手人和状态', async () => {
    const history = [
      draftOf({ id: 'h1', body: '英语那 8 个老记混的词你单独抄下来了，复习的时候好找。' }),
      draftOf({ id: 'h2', handled_by: 'u-2', handled_at: at(2026, 10, 20), created_at: at(2026, 10, 20), kind: 'nudge', body: '周末有没有空记一两条？' }),
    ];
    renderPanel({ dr: stubDr(history) });

    expect(await screen.findByText('英语那 8 个老记混的词你单独抄下来了，复习的时候好找。')).toBeInTheDocument();
    expect(screen.getByText('10/23 周五')).toBeInTheDocument();
    expect(screen.getByText('每日表扬')).toBeInTheDocument();
    expect(screen.getByText('你 已发')).toBeInTheDocument();
    expect(screen.getByText('10/20 周二')).toBeInTheDocument();
    expect(screen.getByText('提醒')).toBeInTheDocument();
    expect(screen.getByText('李老师 已发')).toBeInTheDocument();
  });

  it('不用发的消息只显示原因，不显示正文', async () => {
    const history = [
      draftOf({ id: 'h1', status: 'skipped', skip_reason: '请假了', body: '这句不该出现。' }),
    ];
    renderPanel({ dr: stubDr(history) });

    expect(await screen.findByText('你 不用发 · 请假了')).toBeInTheDocument();
    expect(screen.queryByText('这句不该出现。')).toBeNull();
  });

  it('推迟的消息显示日期和正文', async () => {
    const history = [
      draftOf({ id: 'h1', status: 'snoozed', snooze_until: '2026-10-29', body: '上周物理牛顿定律记了四次。' }),
    ];
    renderPanel({ dr: stubDr(history) });

    expect(await screen.findByText('你 推迟到 10/29')).toBeInTheDocument();
    expect(screen.getByText('上周物理牛顿定律记了四次。')).toBeInTheDocument();
  });

  it('默认显示最近 3 条，可展开全部', async () => {
    const history = [1, 2, 3, 4, 5].map((n) => draftOf({
      id: `h${n}`,
      handled_at: at(2026, 10, 20 + n),
      created_at: at(2026, 10, 20 + n),
      body: `第 ${n} 条消息`,
    }));
    renderPanel({ dr: stubDr(history) });

    expect(await screen.findByText('第 5 条消息')).toBeInTheDocument();
    expect(screen.queryByText('第 2 条消息')).toBeNull();
    expect(screen.queryByText('第 1 条消息')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '全部 5 条' }));
    expect(screen.getByText('第 2 条消息')).toBeInTheDocument();
    expect(screen.getByText('第 1 条消息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
  });

  it('没有提醒时写没有', async () => {
    renderPanel({ dr: stubDr([draftOf({ id: 'h1' })]) });
    expect(await screen.findByText('上次提醒：没有。同一个学生两次提醒至少隔 3 天。')).toBeInTheDocument();
  });

  it('显示上次提醒日期', async () => {
    renderPanel({
      dr: stubDr([
        draftOf({ id: 'h1' }),
        draftOf({ id: 'h2', kind: 'nudge', handled_at: at(2026, 10, 20), created_at: at(2026, 10, 20) }),
      ]),
    });
    expect(await screen.findByText('上次提醒：10/20 周二。同一个学生两次提醒至少隔 3 天。')).toBeInTheDocument();
  });
});

describe('学生消息面板 · 空状态与刷新', () => {
  it('既没有草稿也没有历史时只显示一行', async () => {
    const { container } = renderPanel({ dr: stubDr([]) });

    expect(await screen.findByText('还没有给这位学生的消息。')).toBeInTheDocument();
    expect(screen.queryByText('今天的消息')).toBeNull();
    expect(screen.queryByText('发过的消息')).toBeNull();
    expect(container.querySelector('.smp-panel')).toBeNull();
  });

  it('换学生时重新读取历史', async () => {
    const loadHistory = jest.fn(async (id) => (id === 's1'
      ? [draftOf({ id: 'a', body: '第一个学生的消息' })]
      : [draftOf({ id: 'b', body: '第二个学生的消息' })]));
    const dr = { loadHistory, handlerName: jest.fn(() => '你') };
    const { rerender } = render(
      <StudentMessagesPanel student={{ id: 's1' }} person={person} draft={null} dr={dr} todayIso="2026-10-26" showMentor={false} />,
    );

    expect(await screen.findByText('第一个学生的消息')).toBeInTheDocument();

    rerender(
      <StudentMessagesPanel student={{ id: 's2' }} person={person} draft={null} dr={dr} todayIso="2026-10-26" showMentor={false} />,
    );

    expect(await screen.findByText('第二个学生的消息')).toBeInTheDocument();
    expect(screen.queryByText('第一个学生的消息')).toBeNull();
    expect(loadHistory).toHaveBeenCalledWith('s2');
  });

  it('草稿状态变了以后重新读取历史', async () => {
    const loadHistory = jest.fn(async () => []);
    const dr = { loadHistory, handlerName: jest.fn(() => '你') };
    const { rerender } = render(
      <StudentMessagesPanel student={{ id: 's1' }} person={person} draft={draftOf({ id: 'd1', status: 'draft' })} dr={dr} todayIso="2026-10-26" showMentor={false} />,
    );

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(1));

    rerender(
      <StudentMessagesPanel student={{ id: 's1' }} person={person} draft={draftOf({ id: 'd1', status: 'sent' })} dr={dr} todayIso="2026-10-26" showMentor={false} />,
    );

    await waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
  });
});
