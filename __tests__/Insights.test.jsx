import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Insights from '../src/pages/student/Insights';
import Review from '../src/pages/Review';
import { headlineInsight } from '../src/lib/studentStats.js';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

// 2026-10-24 周六 15:00（本周 10/19–10/25）
const TODAY = new Date(2026, 9, 24, 15, 0);
const COURSES = {
  phys: { id: 'c-phys', name: 'AP 物理 C', course_type: 2 },
  calc: { id: 'c-calc', name: 'AP 微积分 BC', course_type: 1 },
  chem: { id: 'c-chem', name: 'AP 化学', course_type: 2 },
};

let n = 0;
function row(o) {
  n += 1;
  const key = o.key || 'phys';
  return {
    id: `s-${n}`, student_id: 'u1', session_date: '2026-10-24', start_time: '19:00:00',
    duration_minutes: 30, category: 1, form: '自主学习', self_rating: 80, grade_label: null,
    score: null, deleted_at: null, chapter_id: null, unit_id: null,
    course: COURSES[key], course_id: COURSES[key].id, ...o,
  };
}

function seed() {
  n = 0;
  supabase.__resetMocks();
  setAuthUser({ id: 'u1' });
  setAuthProfile({ id: 'u1', full_name: '一舟' });
  supabase.__setTableData('learning_sessions', [
    row({ duration_minutes: 40, category: 2 }),
    row({ key: 'calc', duration_minutes: 45, category: 3, form: '自主练习' }),             // 待补填
    row({ session_date: '2026-10-23', duration_minutes: 10 }),
    row({ session_date: '2026-10-22', duration_minutes: 60 }),
    row({ session_date: '2026-10-21', duration_minutes: 20 }),
    row({ session_date: '2026-10-20', key: 'calc', duration_minutes: 30 }),
    row({ session_date: '2026-10-18', duration_minutes: 30 }),
    // 自评 vs 实测（近 4 周的练习）
    row({ session_date: '2026-10-10', key: 'calc', category: 3, self_rating: 80, grade_label: 'B+' }),
    row({ session_date: '2026-10-11', key: 'phys', category: 3, self_rating: 80, grade_label: 'C+' }),
    row({ session_date: '2026-10-12', key: 'chem', category: 3, self_rating: 60, grade_label: 'B' }),
    row({ session_date: '2026-10-24', duration_minutes: 999, deleted_at: '2026-10-24T01:00:00Z' }),
  ]);
  supabase.__setTableData('courses', [
    { ...COURSES.calc, created_by: 'u1', deleted_at: null, subject: '' },
  ]);
  supabase.__setTableData('exam_scores', [
    { id: 'e1', student_id: 'u1', course_id: 'c-calc', exam_name: '月考', exam_date: '2026-09-26', score: 88, grade_label: 'B+', deleted_at: null },
    { id: 'e2', student_id: 'u1', course_id: 'c-calc', exam_name: '期中', exam_date: '2026-10-22', score: 91, grade_label: 'A-', deleted_at: null },
    { id: 'e3', student_id: 'u1', course_id: 'c-phys', exam_name: '外校考试', exam_date: '2026-10-15', score: 70, deleted_at: null },
  ]);
  supabase.__setTableData('teacher_student_connections', []);
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}
function renderInsights(Page = Insights) {
  return render(
    <MemoryRouter initialEntries={['/insights']}>
      <Routes>
        <Route path="/insights" element={<Page today={TODAY} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(seed);

describe('洞察', () => {
  it('加载中先显示占位', async () => {
    renderInsights();
    expect(screen.getByLabelText('正在加载')).toBeInTheDocument();
    await screen.findByRole('heading', { name: '洞察' });
  });

  it('本周重点排第一，文案与 headlineInsight 一致，动作派发 yb:open-log', async () => {
    const rows = supabase.__getTableData('learning_sessions').filter((s) => !s.deleted_at);
    const expected = headlineInsight(rows, '2026-10-24');
    renderInsights();
    const panel = await screen.findByRole('region', { name: '本周重点' });
    expect(panel).toHaveTextContent(expected.title);
    // 第一块内容就是它
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toBe(panel);

    const got = jest.fn();
    window.addEventListener('yb:open-log', got);
    fireEvent.click(within(panel).getByRole('button', { name: new RegExp(expected.action.label) }));
    expect(await screen.findByTestId('loc')).toHaveTextContent('/records?log=1');
    await waitFor(() => expect(got).toHaveBeenCalled());
    window.removeEventListener('yb:open-log', got);
    expect(got.mock.calls[0][0].detail).toEqual(expected.action.log);
  });

  it('统计面板是一块：总时长、日均、连续、待补填', async () => {
    renderInsights();
    const stats = await screen.findByRole('region', { name: '统计' });
    // 本周 40+45+10+60+20+30 = 205 分 → 3:25；周六是第 6 天 → 日均 34′
    expect(stats).toHaveTextContent('3:25');
    expect(stats).toHaveTextContent('34′');
    expect(stats).toHaveTextContent('5 天');            // 20–24 日；19 日没有记录，连续到此为止
    expect(within(stats).getByRole('link', { name: '1' })).toHaveAttribute('href', '/records?tab=pending');
    expect(stats.querySelectorAll('.sh-stat')).toHaveLength(4);
  });

  it('记录不满 6 周：显示从第一条记录开始的学习日历，而不是 26 周空格', async () => {
    renderInsights();
    await screen.findByRole('region', { name: '统计' });
    expect(document.querySelector('.sh-heat')).toBeNull();
    const cells = document.querySelectorAll('.sh-cal i');
    expect(cells).toHaveLength(3 * 7);                                   // 10/5 那周 → 本周
    expect(document.querySelectorAll('.sh-cal i.before')).toHaveLength(5); // 10/5–10/9 早于第一条记录
    const rest = document.querySelectorAll('.sh-cal i.rest');
    // 第一条记录（10/10）之后、今天之前每个没有记录的日子都标为休息：10/13–10/17 与 10/19
    expect(rest).toHaveLength(6);
    expect(rest[5].getAttribute('title')).toBe('10月19日 休息');
    expect(document.querySelector('.sh-cal i.today')).toHaveTextContent('24');
    expect(document.querySelectorAll('.sh-cal i.future')).toHaveLength(1);  // 只有周日 10/25
  });

  it('记录满 6 周：热力图从第一条记录所在周开始', async () => {
    seed();
    const rows = supabase.__getTableData ? supabase.__getTableData('learning_sessions') : null;
    supabase.__setTableData('learning_sessions', [
      ...(rows || []),
      row({ session_date: '2026-08-10', duration_minutes: 50 }),        // 周一，距本周 10 周
    ].filter(Boolean));
    renderInsights();
    await screen.findByRole('region', { name: '统计' });
    expect(document.querySelector('.sh-cal')).toBeNull();
    expect(document.querySelectorAll('.sh-heat i')).toHaveLength(11 * 7);
    expect(screen.getByRole('heading', { name: /^11 周/ })).toBeInTheDocument();
  });

  it('记录很长：热力图最多 26 周', async () => {
    seed();
    const rows = supabase.__getTableData ? supabase.__getTableData('learning_sessions') : null;
    supabase.__setTableData('learning_sessions', [
      ...(rows || []),
      row({ session_date: '2026-01-05', duration_minutes: 50 }),
    ].filter(Boolean));
    renderInsights();
    await screen.findByRole('region', { name: '统计' });
    expect(document.querySelectorAll('.sh-heat i')).toHaveLength(26 * 7);
    expect(document.querySelectorAll('.sh-heat i.l4').length).toBeGreaterThan(0);
  });

  it('科目分布按本周分钟排序', async () => {
    renderInsights();
    const sec = await screen.findByRole('region', { name: '科目分布' });
    const names = Array.from(sec.querySelectorAll('.sh-subj .name')).map((e) => e.textContent);
    expect(names).toEqual(['AP 物理 C', 'AP 微积分 BC']);   // 130 vs 75
    expect(sec).toHaveTextContent('2 小时 10 分');
  });

  it('自评 vs 实测：一致 / 偏乐观 / 偏保守，待补填与 N/A 不参与', async () => {
    renderInsights();
    const sec = await screen.findByRole('region', { name: '自评与实测' });
    const line = (name) => within(sec).getByText(name).closest('.sh-li');
    expect(line('AP 微积分 BC')).toHaveTextContent('自评 基本掌握 · 实测平均 B+');
    expect(line('AP 微积分 BC')).toHaveTextContent('一致');
    expect(line('AP 物理 C')).toHaveTextContent('偏乐观');
    expect(line('AP 化学')).toHaveTextContent('自评 有不少没掌握 · 实测平均 B');
    expect(line('AP 化学')).toHaveTextContent('偏保守');
    expect(sec.querySelectorAll('.sh-li')).toHaveLength(3);
  });

  it('考试趋势：只列有成绩的校内课程，显示最新分与等第', async () => {
    renderInsights();
    const sec = await screen.findByRole('region', { name: '考试趋势' });
    expect(sec).toHaveTextContent('AP 微积分 BC');
    expect(sec).toHaveTextContent('2 次考试 · 最近 10月22日');
    expect(sec.querySelector('.sh-exam-score')).toHaveTextContent('91A-');
    expect(sec.querySelector('.sh-spark polyline')).toBeInTheDocument();
    expect(sec).not.toHaveTextContent('AP 物理 C');           // 校外课程不进校内趋势
  });

  it('考试趋势：只有等第或只有分数的考试都能显示，空分数不当成 0', async () => {
    supabase.__setTableData('exam_scores', [
      { id: 'g1', student_id: 'u1', course_id: 'c-calc', exam_name: '月考', exam_date: '2026-10-01', score: null, grade_label: 'B+', deleted_at: null },
      { id: 'g2', student_id: 'u1', course_id: 'c-calc', exam_name: '期中', exam_date: '2026-10-22', score: '', grade_label: 'A-', deleted_at: null },
    ]);
    renderInsights();
    const sec = await screen.findByRole('region', { name: '考试趋势' });
    expect(sec).toHaveTextContent('2 次考试 · 最近 10月22日');
    expect(sec.querySelector('.sh-exam-score')).toHaveTextContent('A-');
    expect(sec.querySelector('.sh-exam-score')).not.toHaveTextContent('0');
    expect(sec.querySelector('.sh-spark')).toBeNull();
  });

  it('没有任何记录：各块给出平实的空状态', async () => {
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('exam_scores', []);
    renderInsights();
    const hero = await screen.findByRole('region', { name: '本周重点' });
    expect(hero).toHaveTextContent('还没有学习记录');
    expect(screen.getByText(/本周还没有记录，记一次就会出现在这里/)).toBeInTheDocument();
    expect(screen.getByText(/补上练习的客观评价后/)).toBeInTheDocument();
    expect(screen.getByText(/还没有考试成绩/)).toBeInTheDocument();
    expect(document.querySelector('.sh-heat i.rest')).toBeNull();
    expect(screen.getByText('记下第一条后，这里会出现你的学习日历。')).toBeInTheDocument();
  });

  it('加载失败：显示错误并可重试', async () => {
    const real = supabase.from.bind(supabase);
    let fail = true;
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
      if (t !== 'learning_sessions' || !fail) return real(t);
      const q = {};
      ['select', 'eq', 'is', 'gte', 'lt', 'order'].forEach((m) => { q[m] = () => q; });
      q.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return q;
    });
    renderInsights();
    expect(await screen.findByRole('alert')).toHaveTextContent('没能加载你的记录');
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
    expect(await screen.findByRole('heading', { name: '洞察' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('/review 渲染新的洞察页', async () => {
    renderInsights(Review);
    expect(await screen.findByRole('region', { name: '本周重点' })).toBeInTheDocument();
  });
});
