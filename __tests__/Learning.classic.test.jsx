import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { setRecordUi, getRecordUi } from '../src/lib/recordUiPref.js';

// 旧版记录界面：内嵌表单与 2.0 sheet 走同一个保存口径（payload 与 sessionRules 一致）。

const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2026-02-01',
  chapters: [{ id: 'ch-1', name: '函数', deleted_at: null, units: [{ id: 'u-1', name: '一次函数', deleted_at: null }] }],
};

function seed(sessions = []) {
  supabase.__setTableData('courses', [COURSE_ROW]);
  supabase.__setTableData('learning_sessions', sessions);
  supabase.__setTableData('user_learning_forms', []);
}
const lastCall = (method) => supabase.__getCallHistory().filter(c => c.method === method && c.table === 'learning_sessions').pop();
function renderLearning() {
  return render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
}
async function classicForm() {
  const form = await screen.findByRole('region', { name: '记录学习' });
  await waitFor(() => expect(screen.getByRole('combobox', { name: '课程' })).toHaveValue('course-1'));
  return form;
}

beforeEach(() => {
  localStorage.clear();
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'test-user-1', email: 'test@example.com' },
    session: { user: { id: 'test-user-1', email: 'test@example.com' } },
  });
  setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
  setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户' });
});

test('默认是新版：没有内嵌表单', async () => {
  expect(getRecordUi()).toBe('new');
  seed();
  renderLearning();
  await screen.findByRole('button', { name: '记一下' });
  expect(screen.queryByRole('region', { name: '记录学习' })).toBeNull();
});

test('旧版：内嵌表单，开始默认为现在，快速时长往后推，保存口径不变', async () => {
  setRecordUi('classic');
  seed();
  renderLearning();
  await classicForm();
  expect(screen.queryByRole('dialog')).toBeNull();
  const [start, end] = document.querySelectorAll('input[type="time"]');
  expect(start.value).toMatch(/^\d\d:\d\d$/);
  fireEvent.change(start, { target: { value: '14:00' } });
  fireEvent.click(screen.getByRole('button', { name: '45分钟' }));
  expect(end.value).toBe('14:45');
  fireEvent.change(screen.getByRole('combobox', { name: '学习行为形式' }), { target: { value: '自主预习' } });
  fireEvent.change(screen.getByRole('slider', { name: '主观评价' }), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
  await waitFor(() => expect(lastCall('insert')).toBeDefined());
  const p = lastCall('insert').args;
  expect(p).toMatchObject({
    course_id: 'course-1', category: 1, form: '自主预习', start_time: '14:00:00', end_time: '14:45:00',
    duration_minutes: 45, self_rating: 100, grade_label: null, eval_type: 1,
  });
  // 保存后时间回到默认，形式保留（与改版前一致）
  await waitFor(() => expect(end.value).toBe(''));
  expect(screen.getByRole('combobox', { name: '学习行为形式' })).toHaveValue('自主预习');
});

test('旧版：练习默认客观 B+，稍后补充写 null', async () => {
  setRecordUi('classic');
  seed();
  renderLearning();
  await classicForm();
  const [start, end] = document.querySelectorAll('input[type="time"]');
  fireEvent.change(start, { target: { value: '08:00' } });
  fireEvent.change(end, { target: { value: '08:40' } });
  fireEvent.click(screen.getByRole('radio', { name: '练习' }));
  fireEvent.change(screen.getByRole('combobox', { name: '学习行为形式' }), { target: { value: '自主练习' } });
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
  await waitFor(() => expect(lastCall('insert')).toBeDefined());
  expect(lastCall('insert').args).toMatchObject({ category: 3, grade_label: 'B+', eval_type: 2, self_rating: 80 });

  fireEvent.change(start, { target: { value: '09:00' } });
  fireEvent.change(end, { target: { value: '09:30' } });
  fireEvent.click(screen.getByRole('radio', { name: '稍后补充' }));
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
  await waitFor(() => expect(lastCall('insert').args.start_time).toBe('09:00:00'));
  expect(lastCall('insert').args).toMatchObject({ grade_label: null, eval_type: 1 });
});

test('旧版：点记录的编辑按钮回填到内嵌表单，保存走 update', async () => {
  setRecordUi('classic');
  seed([{
    id: 's-1', student_id: 'test-user-1', course_id: 'course-1', chapter_id: 'ch-1', unit_id: null,
    session_date: '2026-01-05', start_time: '19:00:00', end_time: '19:45:00', duration_minutes: 45,
    category: 2, form: '自主复习', eval_type: 1, self_rating: 60, grade_label: null, score: null, notes: '旧备注',
    deleted_at: null, created_at: '2026-01-05T19:45:00Z', course: { id: 'course-1', name: '数学', subject: '', course_type: 1 },
  }]);
  renderLearning();
  await classicForm();
  fireEvent.click(await screen.findByRole('button', { name: '编辑这条记录' }));
  await screen.findByRole('region', { name: '编辑记录' });
  expect(screen.getByLabelText('备注')).toHaveValue('旧备注');
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '新备注' } });
  fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
  await waitFor(() => expect(lastCall('update')).toBeDefined());
  expect(lastCall('update').args).toMatchObject({
    notes: '新备注', category: 2, form: '自主复习', chapter_id: 'ch-1', unit_id: null, self_rating: 60,
    start_time: '19:00:00', end_time: '19:45:00',
  });
  await screen.findByRole('region', { name: '记录学习' });
});
