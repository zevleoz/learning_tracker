import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { loadOutbox, OUTBOX_KEY } from '../src/lib/outbox.js';

// 回归背景：学生网络失败时保存只弹瞬时 toast，"以为存上了其实没存上"。
// 现在：失败 → 本机暂存 + 常驻「N 条待同步」状态条；恢复 → 手动/自动重试补传。

const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1',
  deleted_at: null, chapters: [],
};

function seedBase() {
  supabase.__setTableData('courses', [COURSE_ROW]);
  supabase.__setTableData('learning_sessions', []);
  supabase.__setTableData('user_learning_forms', []);
}

function renderLearning() {
  return render(
    <MemoryRouter>
      <Learning />
    </MemoryRouter>
  );
}

async function waitForForm() {
  fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^保存记录/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument();
  });
}
const syncStatus = () => screen.queryByText(/条待同步/);

function fillAndSubmit() {
  const timeInputs = document.querySelectorAll('input[type="time"]');
  fireEvent.change(timeInputs[0], { target: { value: '09:00' } });
  fireEvent.change(timeInputs[1], { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: '自主预习' }));
  fireEvent.click(screen.getByRole('button', { name: /^保存记录/ }));
}

describe('Learning · 保存失败暂存与补传', () => {
  beforeEach(() => {
    localStorage.removeItem(OUTBOX_KEY);
    supabase.__resetMocks();
    supabase.__setAuthState({
      user: { id: 'test-user-1', email: 'test@example.com' },
      session: { user: { id: 'test-user-1', email: 'test@example.com' } },
    });
    setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
    setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户', school_name: '测试学校' });
    supabase.__setTableData('profiles', [
      { id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户', school_name: '测试学校' },
    ]);
  });

  test('保存失败：记录暂存本机 + 待同步状态出现，不写库', async () => {
    seedBase();
    supabase.__setInsertError('learning_sessions', { message: 'fetch failed' });
    renderLearning();
    await waitForForm();

    fillAndSubmit();

    await waitFor(() => {
      expect(syncStatus()).not.toBeNull();
      expect(syncStatus().closest('[role="status"]')).toHaveTextContent('1 条待同步');
    });
    // 没写进库，但本机队列里有
    expect(supabase.__getTableData('learning_sessions')).toHaveLength(0);
    const items = loadOutbox();
    expect(items).toHaveLength(1);
    expect(items[0].payload.start_time).toBe('09:00:00');
    expect(items[0].payload.end_time).toBe('10:00:00');
  });

  test('恢复后点「重试」：补传成功、待同步状态消失', async () => {
    seedBase();
    supabase.__setInsertError('learning_sessions', { message: 'fetch failed' });
    renderLearning();
    await waitForForm();
    fillAndSubmit();
    await waitFor(() => expect(syncStatus()).not.toBeNull());

    // 网络恢复
    supabase.__setInsertError('learning_sessions', null);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(syncStatus()).toBeNull();
    });
    const rows = supabase.__getTableData('learning_sessions');
    expect(rows).toHaveLength(1);
    expect(rows[0].start_time).toBe('09:00:00');
    expect(loadOutbox()).toHaveLength(0);
  });

  test('暂存期间学生已手动补了同一时段：重试丢弃暂存，不重复写库', async () => {
    seedBase();
    supabase.__setInsertError('learning_sessions', { message: 'fetch failed' });
    renderLearning();
    await waitForForm();
    fillAndSubmit();
    await waitFor(() => expect(syncStatus()).not.toBeNull());

    // 暂存期间，同一时段已有别的记录落库（比如学生换设备补填了）
    supabase.__setInsertError('learning_sessions', null);
    supabase.__setTableData('learning_sessions', [
      { id: 'session-x', student_id: 'test-user-1', course_id: 'course-1',
        session_date: loadOutbox()[0].payload.session_date,
        start_time: '09:30:00', end_time: '10:30:00', deleted_at: null },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(syncStatus()).toBeNull();
    });
    // 队列清空，且没有重复写入
    expect(loadOutbox()).toHaveLength(0);
    expect(supabase.__getTableData('learning_sessions')).toHaveLength(1);
  });
  test('同时触发多次冲刷（挂载 + online 事件 + 点重试）：同一条暂存只写一次', async () => {
    seedBase();
    const payload = {
      student_id: 'test-user-1', course_id: 'course-1', chapter_id: null, unit_id: null,
      category: 1, form: '自主预习', eval_type: 1, duration_minutes: 60, notes: null,
      session_date: '2026-01-05', start_time: '09:00:00', end_time: '10:00:00',
      self_rating: 80, grade_label: null,
    };
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: 'ob-1', savedAt: '2026-01-05T10:00:00Z', kind: 'learning_session', payload }]));
    renderLearning();
    // 挂载时的冲刷还在进行，网络恢复事件又来两次
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(loadOutbox()).toHaveLength(0));
    await new Promise(r => setTimeout(r, 50));
    expect(supabase.__getTableData('learning_sessions')).toHaveLength(1);
    const inserts = supabase.__getCallHistory().filter(c => c.method === 'insert' && c.table === 'learning_sessions');
    expect(inserts).toHaveLength(1);
  });
});
