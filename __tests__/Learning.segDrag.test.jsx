import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

// 分段控件横滑：按住一格横向滑到另一格就选中它（点按仍走 click）。
// jsdom 里所有元素宽度都是 0，给每格铺一排假坐标。

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

function renderLearning() {
  return render(<MemoryRouter initialEntries={['/learning']}><Learning /></MemoryRouter>);
}

// jsdom 没有 PointerEvent：用带 clientX / clientY 的 MouseEvent 派发 pointer* 事件
function pe(type, clientX, clientY = 20) {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
}

// 给控件里的每格铺 90px 宽的假坐标，再从 fromX 滑到 toX
function slideSeg(el, fromX, toX) {
  const btns = Array.from(el.querySelectorAll('button'));
  btns.forEach((b, i) => {
    b.getBoundingClientRect = () => ({
      left: i * 90, right: (i + 1) * 90 - 1, top: 0, bottom: 34, width: 89, height: 34, x: i * 90, y: 0,
    });
  });
  fireEvent(btns[0], pe('pointerdown', fromX));
  fireEvent(window, pe('pointermove', toX));
  fireEvent(window, pe('pointerup', toX));
}

async function openSheet() {
  fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
  await screen.findByRole('dialog', { name: '记一下' });
  await waitFor(() => expect(screen.getByRole('button', { name: '数学', pressed: true })).toBeInTheDocument());
}

describe('记一下 · 类别分段横滑', () => {
  test('从「学习」滑到「练习」：选中练习，并显示客观评价', async () => {
    seed();
    renderLearning();
    await openSheet();
    const seg = screen.getByRole('radiogroup', { name: '学习行为类别' });
    slideSeg(seg, 30, 200);
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '学习' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radiogroup', { name: '客观评价填写方式' })).toBeInTheDocument();
  });

  test('点按仍然生效（不经过拖动）', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    expect(screen.getByRole('radio', { name: '练习' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('记一下 · 客观评价方式分段横滑', () => {
  test('滑到「稍后补充」：选中并显示提示', async () => {
    seed();
    renderLearning();
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: '练习' }));
    const seg = screen.getByRole('radiogroup', { name: '客观评价填写方式' });
    slideSeg(seg, 40, 140);
    expect(screen.getByRole('radio', { name: '稍后补充' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('已选择稍后补充。可在「待补填」里一键补填客观评价。')).toBeInTheDocument();
  });
});

describe('记录 · 全部 / 待补填 / 考试 分段横滑', () => {
  test('从「全部」滑到「待补填」：切到待补填列表', async () => {
    seed();
    renderLearning();
    const tablist = await screen.findByRole('tablist', { name: '记录分类' });
    await screen.findByRole('tab', { name: /全部/ });
    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
    slideSeg(tablist, 20, 140);
    expect(screen.getByRole('tab', { name: /待补填/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'false');
  });
});
