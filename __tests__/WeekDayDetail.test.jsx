import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WeekReviewDashboard from '../src/components/WeekReviewDashboard.jsx';
import { getMonday } from '../src/components/WeekGrid.jsx';

// ───────────────────────────────────────────────────────────────
// 导师端周历：点击日期 → 周行下方内联展开当日明细（含备注原文）
// 数据固定对应当前真实周的周一 / 周二，保证「本周」预设可见
// ───────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toShort(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }

const monday = getMonday(new Date());
const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1);

const MONDAY_NOTE = '今天题量偏少，但错题都重新做了一遍';
const TUESDAY_NOTE = '周二备注不应在周一展开时出现';

const sessions = [
  {
    id: 's1', date: toKey(monday), time: '14:30', duration_minutes: 45,
    category: 3, form: '自主练习', eval_type: 2, score: 87, grade_label: 'B+',
    subject: '数学', chapter: { name: '第3章' }, unit: { name: '3.2 一元二次方程' },
    notes: MONDAY_NOTE, created_at: '2026-10-05T14:30:00Z',
  },
  {
    id: 's2', date: toKey(monday), time: '19:00', duration_minutes: 30,
    category: 1, form: '自主预习', eval_type: 1, self_rating: 80,
    subject: '英语', chapter: null, unit: null,
    notes: '', created_at: '2026-10-05T19:00:00Z',
  },
  {
    id: 's3', date: toKey(tuesday), time: '20:00', duration_minutes: 20,
    category: 2, form: '自主复习', eval_type: 1, self_rating: 60,
    subject: '物理', notes: TUESDAY_NOTE, created_at: '2026-10-06T20:00:00Z',
  },
];

function dayCard(date) {
  const label = screen.getAllByText(toShort(date))
    .find(el => el.closest('[role="button"]'));
  return label?.closest('[role="button"]');
}

describe('导师端周历 · 点击日期展开当日明细', () => {
  test('点击周一卡片：展开当天两条记录，备注原文完整显示，不混入其他日期', async () => {
    render(<WeekReviewDashboard sessions={sessions} student={{ full_name: 'Leo' }} />);

    fireEvent.click(dayCard(monday));

    const panel = within(screen.getByRole('region', { name: '当日学习明细' }));

    // 面板头部：日期 + 记录数
    expect(panel.getByText(
      `${monday.getMonth() + 1}月${monday.getDate()}日 周一`
    )).toBeInTheDocument();
    expect(panel.getByText('2 条记录')).toBeInTheDocument();

    // 当天两条记录明细（学科在日历卡片中也会出现，故限定在面板内断言）
    expect(panel.getByText('数学')).toBeInTheDocument();
    expect(panel.getByText('英语')).toBeInTheDocument();
    expect(panel.getByText('第3章 · 3.2 一元二次方程')).toBeInTheDocument();
    expect(panel.getByText('主观：基本掌握')).toBeInTheDocument();
    expect(panel.getByText('客观：B+')).toBeInTheDocument();

    // 备注原文（完整展示）
    expect(panel.getByText(MONDAY_NOTE)).toBeInTheDocument();
    // 其他日期的备注不出现
    expect(screen.queryByText(TUESDAY_NOTE)).not.toBeInTheDocument();
  });

  test('再次点击同一天 / 点「收起」均关闭面板', async () => {
    render(<WeekReviewDashboard sessions={sessions} student={{ full_name: 'Leo' }} />);

    fireEvent.click(dayCard(monday));
    expect(screen.getByText(MONDAY_NOTE)).toBeInTheDocument();

    // 再次点击同一天 → 收起
    fireEvent.click(dayCard(monday));
    await waitFor(() => {
      expect(screen.queryByText(MONDAY_NOTE)).not.toBeInTheDocument();
    });

    // 重新展开后用「收起」按钮关闭
    fireEvent.click(dayCard(monday));
    expect(screen.getByText(MONDAY_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByText('收起'));
    await waitFor(() => {
      expect(screen.queryByText(MONDAY_NOTE)).not.toBeInTheDocument();
    });
  });
});