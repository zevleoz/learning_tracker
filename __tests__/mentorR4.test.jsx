import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Mentor from '../src/pages/Mentor';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth.js';
import { scoreToGrade } from '../src/components/WeekGrid.jsx';
import { generateDiagnosis } from '../src/components/DeepDivePanels.jsx';
import { msUntilNextMidnight } from '../src/lib/e4DayKey.js';

// 发布前审查：断开连接的错误反馈、等第换算、客观评价只属于练习、E4 零点刷新

function setup() {
  const me = { id: 'mentor-1', role: 2 };
  supabase.__setAuthState({ user: { id: me.id, email: 'x@test.com' }, session: { user: { id: me.id } } });
  setAuthUser({ id: me.id, email: 'x@test.com' });
  setAuthProfile({ id: me.id, role: me.role, full_name: '老师', default_workspace: 'tracker' });
  supabase.__setTableData('profiles', [
    { id: me.id, role: me.role, full_name: '老师' },
    { id: 's-1', role: 1, full_name: '小林', school_name: '学校A', created_at: '2024-01-01T00:00:00' },
  ]);
  supabase.__setTableData('teacher_student_connections', [
    { id: 'c-1', teacher_id: me.id, student_id: 's-1', status: 1, mentor_alias: '小林(Angela)', note: '' },
  ]);
  supabase.__setTableData('learning_sessions', []);
  supabase.__setTableData('supervision_drafts', []);
}

function captureToasts() {
  const seen = [];
  const handler = (e) => seen.push(e.detail);
  window.addEventListener('gpa-toast', handler);
  return { seen, stop: () => window.removeEventListener('gpa-toast', handler) };
}

async function clickDisconnect() {
  render(<MemoryRouter initialEntries={['/mentor']}><Mentor /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByText('小林').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button', { name: '断开' }));
  await screen.findByText(/确定断开与这位学生的连接吗/);
  const buttons = screen.getAllByRole('button', { name: '断开' });
  fireEvent.click(buttons[buttons.length - 1]); // 确认框在 body 末尾
}

describe('断开连接 · 数据库补丁没执行 / 函数报错', () => {
  it('函数报错时给出原因，连接保持「已连接」', async () => {
    setup();
    supabase.__setRpcResponse('mentor_disconnect', { data: null, error: { code: 'P0001', message: '没有找到已连接的这位学生' } });
    const t = captureToasts();
    await clickDisconnect();
    await waitFor(() => expect(t.seen.some((x) => /断开失败：没有找到已连接的这位学生/.test(x.title))).toBe(true));
    expect(supabase.__getTableData('teacher_student_connections')[0].status).toBe(1);
    t.stop();
  });

  it('函数不存在时退回直接更新；更新成功才显示已断开', async () => {
    setup();
    supabase.__setRpcResponse('mentor_disconnect', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.mentor_disconnect' } });
    const t = captureToasts();
    await clickDisconnect();
    await waitFor(() => expect(t.seen.some((x) => x.title === '已断开连接')).toBe(true));
    expect(supabase.__getTableData('teacher_student_connections')[0].status).toBe(2);
    t.stop();
  });
});

describe('等第换算与学生端一致', () => {
  it('导师端 scoreToGrade 含 A+ / D+ / D-', () => {
    expect(scoreToGrade(98)).toBe('A+');
    expect(scoreToGrade(93)).toBe('A');
    expect(scoreToGrade(68)).toBe('D+');
    expect(scoreToGrade(61)).toBe('D-');
    expect(scoreToGrade(59)).toBe('F');
  });
});

describe('客观评价只属于练习', () => {
  const day = (d) => `2026-10-${String(d).padStart(2, '0')}`;
  const s = (d, extra) => ({
    id: `x${d}${Math.random()}`, date: day(d), session_date: day(d), duration_minutes: 100, form: '自主预习',
    subject: '数学', category: 1, self_rating: 80, grade_label: null, score: null, ...extra,
  });
  it('学习 / 复习记录里残留的分数不进入学科均分诊断', () => {
    // 3 条非练习记录带低分，若被计入会触发「学习行为正常但成绩偏低」
    const sessions = [
      s(20, { category: 2, score: 40, eval_type: 2 }),
      s(21, { category: 2, score: 40, eval_type: 2 }),
      s(22, { category: 2, score: 40, eval_type: 2 }),
      s(23, { category: 2 }), s(24, { category: 2 }),
    ];
    const out = generateDiagnosis(sessions, { today: '2026-10-24' });
    expect(out.some((d) => /成绩偏低/.test(d.title))).toBe(false);
  });
  it('练习里的字母等第仍计入，N/A 不计', () => {
    const sessions = [
      s(20, { category: 3, grade_label: 'D' }), s(21, { category: 3, grade_label: 'D' }), s(22, { category: 3, grade_label: 'D' }),
      s(23, { category: 3, grade_label: 'N/A' }),
      s(24, { category: 2 }), s(23, { category: 2 }), s(22, { category: 2 }), s(21, { category: 2 }),
    ];
    const out = generateDiagnosis(sessions, { today: '2026-10-24' });
    expect(out.some((d) => /成绩偏低/.test(d.title))).toBe(true);
  });
});

describe('E4 零点刷新', () => {
  it('距下一个本地零点的毫秒数', () => {
    const now = new Date(2026, 9, 26, 23, 59, 0, 0);
    const ms = msUntilNextMidnight(now);
    expect(ms).toBeGreaterThanOrEqual(60 * 1000);
    expect(ms).toBeLessThan(62 * 1000);
  });
});
