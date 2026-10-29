import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

// 记一下 · 手机下拉关闭：从把手 / 标题往下拖，超过 120px 走「放弃这条记录？」确认；
// 取消则弹回，内容没滚到顶时不拖面板。

const COURSE_ROW = {
  id: 'course-1', name: '数学', subject: '', course_type: 1,
  school_id: 'school-1', created_by: 'test-user-1', deleted_at: null, created_at: '2026-02-01',
  chapters: [{ id: 'ch-1', name: '函数', deleted_at: null, units: [{ id: 'u-1', name: '一次函数', deleted_at: null }] }],
};

function seed() {
  supabase.__setTableData('courses', [COURSE_ROW]);
  supabase.__setTableData('learning_sessions', []);
  supabase.__setTableData('user_learning_forms', []);
}

beforeEach(() => {
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'test-user-1', email: 'test@example.com' },
    session: { user: { id: 'test-user-1', email: 'test@example.com' } },
  });
  setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
  setAuthProfile({ id: 'test-user-1', email: 'test@example.com', role: 1, full_name: '测试用户' });
});

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
  await screen.findByRole('dialog', { name: '记一下' });
  await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
}

// jsdom 没有 PointerEvent：用带 pageX / pageY 的 MouseEvent 派发 pointer* 事件
function pe(type, clientY, extra = {}) {
  return new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: 100, clientY, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra,
  });
}

async function dragHeader(dy) {
  const header = document.querySelector('.yb-sheet__h');
  fireEvent(header, pe('pointerdown', 200));
  fireEvent(window, pe('pointermove', 200 + dy));
  // 让 framer 的帧循环记下这次移动（否则按下 / 抬起之间不算拖动）
  await act(async () => { await new Promise(r => setTimeout(r, 40)); });
  fireEvent(window, pe('pointerup', 200 + dy));
  // onDragEnd 在下一帧回调，放进 act 里等它跑完（关闭 / 弹回都发生在这里）
  await act(async () => { await new Promise(r => setTimeout(r, 40)); });
}

describe('记一下 · 下拉关闭', () => {
  test('有未保存改动：下拉超过 120px 先 confirm；取消则留在弹层', async () => {
    seed();
    render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
    await openSheet();
    fireEvent.change(document.querySelectorAll('input[type="time"]')[0], { target: { value: '08:00' } });

    const orig = window.confirm;
    window.confirm = jest.fn(() => false);
    try {
      await dragHeader(200);
      await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('放弃这条记录？'));
      expect(screen.getByRole('dialog', { name: '记一下' })).toBeInTheDocument();
    } finally {
      window.confirm = orig;
    }
  });

  test('确认放弃后关闭', async () => {
    seed();
    render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
    await openSheet();
    fireEvent.change(document.querySelectorAll('input[type="time"]')[0], { target: { value: '08:00' } });

    const orig = window.confirm;
    window.confirm = jest.fn(() => true);
    try {
      await dragHeader(200);
      await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('放弃这条记录？'));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一下' })).not.toBeInTheDocument());
    } finally {
      window.confirm = orig;
    }
  });

  test('没改动时下拉直接关闭，不弹 confirm', async () => {
    seed();
    render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
    await openSheet();
    const orig = window.confirm;
    window.confirm = jest.fn();
    try {
      await dragHeader(200);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '记一下' })).not.toBeInTheDocument());
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = orig;
    }
  });

  test('短距离下拉（不满 120px）不关闭', async () => {
    seed();
    render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
    await openSheet();
    const orig = window.confirm;
    window.confirm = jest.fn();
    try {
      await dragHeader(60);
      await new Promise(r => setTimeout(r, 60));
      expect(screen.getByRole('dialog', { name: '记一下' })).toBeInTheDocument();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = orig;
    }
  });

  test('表单内容已向下滚动：不拖面板（下拉不关闭）', async () => {
    seed();
    render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
    await openSheet();
    const body = document.querySelector('.yb-sheet__b');
    body.scrollTop = 120;

    const orig = window.confirm;
    window.confirm = jest.fn();
    try {
      await dragHeader(200);
      await new Promise(r => setTimeout(r, 60));
      expect(screen.getByRole('dialog', { name: '记一下' })).toBeInTheDocument();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = orig;
    }
  });
});
