import { render, screen, fireEvent, within } from '@testing-library/react';
import WeekReviewDashboard from '../src/components/WeekReviewDashboard.jsx';
import { getMonday } from '../src/components/WeekGrid.jsx';

// ───────────────────────────────────────────────────────────────
// 导师端周复盘：默认时段覆盖补填记录 + 时段外记录常驻提示
// 回归背景：学生补填旧日期记录时，默认「本周」视图完全看不到，
// 琥珀色横幅又只覆盖近 7 天提交——更早的记录会彻底隐形。
// ───────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function toKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toShort(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

const monday = getMonday(new Date());
const TODAY_NOTE = '今天的记录';
const BACKFILL_NOTE = '今天补填上周的记录';
const OLD_NOTE = '二十天前的旧记录';

// 上周三（相对本周一固定 -5 天，保证落在「本周」之外、近4周之内）
const lastWed = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 5);
const old20 = daysAgo(20);

const sessions = [
  {
    id: 's-today', date: toKey(new Date()), time: '10:00', duration_minutes: 30,
    category: 1, form: '自主预习', eval_type: 1, self_rating: 80,
    subject: '数学', notes: TODAY_NOTE, created_at: new Date().toISOString(),
  },
  {
    id: 's-backfill', date: toKey(lastWed), time: '11:00', duration_minutes: 40,
    category: 2, form: '自主复习', eval_type: 1, self_rating: 60,
    subject: '物理', notes: BACKFILL_NOTE, created_at: new Date().toISOString(),
  },
  {
    id: 's-old', date: toKey(old20), time: '09:00', duration_minutes: 45,
    category: 3, form: '自主练习', eval_type: 1, self_rating: 100,
    subject: '英语', notes: OLD_NOTE, created_at: old20.toISOString(),
  },
];

function dayCard(date) {
  const label = screen.getAllByText(toShort(date))
    .find(el => el.closest('[role="button"]'));
  return label?.closest('[role="button"]');
}

describe('导师端周复盘 · 补填记录可见性', () => {
  test('默认「本周」：本周记录可见；时段外记录由横幅+常驻提示兜底', () => {
    render(<WeekReviewDashboard sessions={sessions} student={{ full_name: '今晚不能熬夜' }} />);

    // 本周记录直接可见
    expect(dayCard(new Date())).toBeTruthy();

    // 琥珀横幅：今天补填的上周三记录（近7天提交、日期在本周之外）
    const amber = screen.getByText(/近 7 天新提交\/补填了/);
    expect(amber.querySelector('strong')).toHaveTextContent('1');

    // 灰色常驻提示：20 天前的旧记录（横幅 7 天窗口覆盖不到）
    const grey = screen.getByText(/所选时段之外还有/);
    expect(grey.querySelector('strong')).toHaveTextContent('1');
  });

  test('切到「近4周」：20 天前的补填记录直接可见，提示条消失', () => {
    render(<WeekReviewDashboard sessions={sessions} student={{ full_name: '今晚不能熬夜' }} />);

    fireEvent.click(screen.getByRole('button', { name: '近4周' }));

    expect(screen.queryByText(/近 7 天新提交/)).not.toBeInTheDocument();
    expect(screen.queryByText(/所选时段之外还有/)).not.toBeInTheDocument();

    fireEvent.click(dayCard(old20));
    const panel = within(screen.getByRole('region', { name: '当日学习明细' }));
    expect(panel.getByText(OLD_NOTE)).toBeInTheDocument();
  });

  test('「查看全部记录」把时段扩到全历史：提示条消失，旧记录可见', () => {
    render(<WeekReviewDashboard sessions={sessions} student={{ full_name: '今晚不能熬夜' }} />);

    fireEvent.click(screen.getByRole('button', { name: '查看全部记录' }));

    expect(screen.queryByText(/近 7 天新提交/)).not.toBeInTheDocument();
    expect(screen.queryByText(/所选时段之外还有/)).not.toBeInTheDocument();

    fireEvent.click(dayCard(old20));
    const panel = within(screen.getByRole('region', { name: '当日学习明细' }));
    expect(panel.getByText(OLD_NOTE)).toBeInTheDocument();
  });
});
