import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Syllabus, { formatHM, summarizeUsage } from '../src/pages/Syllabus';
import { supabase } from '../src/__mocks__/supabase';

const COURSE = {
  id: 'course-1', name: 'AP 微积分 BC', subject: '', course_type: 1, school_id: 'school-1',
  created_by: 'test-user-1', deleted_at: null, created_at: '2026-01-01',
  chapters: [
    {
      id: 'ch-1', name: '第3章 导数应用', order_idx: 1, deleted_at: null,
      units: [
        { id: 'u-1', name: '导数的几何意义', order_idx: 1, deleted_at: null },
        { id: 'u-2', name: '相关变化率', order_idx: 2, deleted_at: null },
        { id: 'u-3', name: '最值问题', order_idx: 3, deleted_at: null },
      ],
    },
  ],
};

function sessionRow(o) {
  return { id: `s-${Math.random()}`, student_id: 'test-user-1', course_id: 'course-1', unit_id: null, duration_minutes: 0, deleted_at: null, ...o };
}

beforeEach(() => {
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'test-user-1', email: 't@example.com' },
    session: { user: { id: 'test-user-1' } },
  });
  supabase.__setTableData('profiles', [{ id: 'test-user-1', role: 1, school_name: '测试学校', school_id: 'school-1' }]);
  supabase.__setTableData('courses', [COURSE]);
  supabase.__setTableData('learning_sessions', [
    sessionRow({ unit_id: 'u-1', duration_minutes: 80 }),
    sessionRow({ unit_id: 'u-1', duration_minutes: 10 }),
    sessionRow({ unit_id: 'u-2', duration_minutes: 45 }),
    sessionRow({ unit_id: null, duration_minutes: 30 }),
    sessionRow({ unit_id: 'u-3', duration_minutes: 999, student_id: 'someone-else' }), // 别人的记录不计入
  ]);
});

function renderReadOnly() {
  return render(
    <MemoryRouter>
      <Syllabus defaultEditing={false} />
    </MemoryRouter>,
  );
}

describe('我的课程 · 覆盖度', () => {
  it('formatHM / summarizeUsage', () => {
    expect(formatHM(0)).toBe('—');
    expect(formatHM(140)).toBe('2:20');
    expect(formatHM(65)).toBe('1:05');
    const u = summarizeUsage([
      { course_id: 'a', unit_id: 'x', duration_minutes: 30 },
      { course_id: 'a', unit_id: 'x', duration_minutes: 15 },
      { course_id: 'a', unit_id: null, duration_minutes: 5 },
    ]);
    expect(u.byUnit.x).toEqual({ minutes: 45, count: 2 });
    expect(u.byCourse.a).toBe(50);
  });

  it('阅读态：按单元显示有无记录与时长，没有任何编辑控件', async () => {
    renderReadOnly();
    expect(await screen.findByText('AP 微积分 BC')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.mec-cov')).toHaveTextContent('2/3')); // 3 个单元里 2 个有记录
    expect(screen.getByText(/累计 2:45/)).toBeInTheDocument();             // 80+10+45+30 分钟
    const row = screen.getByText('导数的几何意义').closest('.mec-un');
    expect(within(row).getByText('有记录')).toBeInTheDocument();
    expect(within(row).getByText('1:30')).toBeInTheDocument();
    const empty = screen.getByText('最值问题').closest('.mec-un');
    expect(within(empty).getByText('无记录')).toBeInTheDocument();

    expect(screen.queryByTitle('删除课程')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /添加新课程/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/目标|还差/)).not.toBeInTheDocument();
  });

  it('记录超过 1000 条时分页取完，靠后的单元也算有记录', async () => {
    const filler = Array.from({ length: 1200 }, (_, i) => sessionRow({
      id: `a-${String(i).padStart(5, '0')}`, unit_id: 'u-1', duration_minutes: 1,
    }));
    supabase.__setTableData('learning_sessions', [
      ...filler,
      sessionRow({ id: 'z-last', unit_id: 'u-3', duration_minutes: 20 }),
    ]);
    renderReadOnly();
    expect(await screen.findByText('AP 微积分 BC')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.mec-cov')).toHaveTextContent('2/3'));
    expect(screen.getByText(/累计 20:20/)).toBeInTheDocument();   // 1200 + 20 分钟
  });

  it('点「编辑」才出现增删改，点「完成」收起', async () => {
    renderReadOnly();
    await screen.findByText('AP 微积分 BC');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('button', { name: /添加新课程/ })).toBeInTheDocument();
    expect(screen.getByTitle('删除课程')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByTitle('删除课程')).not.toBeInTheDocument());
  });

  it('没有课程时给出下一步，而不是空图标', async () => {
    supabase.__setTableData('courses', []);
    renderReadOnly();
    expect(await screen.findByText('还没有课程')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加课程' }));
    expect(await screen.findByRole('button', { name: /添加新课程/ })).toBeInTheDocument();
  });
});
