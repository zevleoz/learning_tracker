import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Layout from '../src/components/Layout.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

function Where() {
  const l = useLocation();
  return (
    <div>
      <div data-testid="where">{l.pathname + l.search}</div>
      <button type="button">再记一次</button>
      <input aria-label="备注" />
    </div>
  );
}

function renderShell(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<Where />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

// jsdom 没有 matchMedia / PointerEvent：模拟手机的粗指针（且不是底栏宽度，避免与 3a 混在一起）
beforeAll(() => {
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
  class FakePointerEvent extends window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = FakePointerEvent;
});

beforeEach(() => {
  supabase.__resetMocks();
  setAuthUser({ id: 'u1' });
  setAuthProfile({ id: 'u1', role: 1, full_name: '陈一舟' });
  supabase.__setTableData('teacher_student_connections', []);
});

function swipeOn(el, fromX, toX, { dy = 0, pointerType = 'touch' } = {}) {
  fireEvent.pointerDown(el, { pointerType, pointerId: 1, clientX: fromX, clientY: 700 });
  fireEvent.pointerUp(el, { pointerType, pointerId: 1, clientX: toX, clientY: 700 + dy });
}

describe('Layout · 3b 页面左右滑切 tab', () => {
  it('左滑去下一个 tab，右滑回上一个', () => {
    renderShell('/records');
    const content = screen.getByTestId('where');

    swipeOn(content, 300, 160); // 左滑 → 洞察
    expect(screen.getByTestId('where')).toHaveTextContent('/insights');

    swipeOn(screen.getByTestId('where'), 300, 440); // 右滑 → 记录
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });

  it('首尾不越界', () => {
    const first = renderShell('/today');
    swipeOn(screen.getByTestId('where'), 300, 460); // 第一屏右滑
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
    first.unmount();

    renderShell('/me');
    swipeOn(screen.getByTestId('where'), 300, 160); // 最后一屏左滑
    expect(screen.getByTestId('where')).toHaveTextContent('/me');
  });

  it('在输入框上滑动不切页', () => {
    renderShell('/records');
    swipeOn(screen.getByLabelText('备注'), 300, 160);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });

  it('在「再记一次」这类可点控件上滑动不切页', () => {
    renderShell('/records');
    swipeOn(screen.getByRole('button', { name: '再记一次' }), 300, 160);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });

  it('从屏幕边缘滑动不切页', () => {
    renderShell('/records');
    swipeOn(screen.getByTestId('where'), 10, 170);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });

  it('记一下面板打开时不切页', () => {
    renderShell('/records');
    const dlg = document.createElement('div');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    swipeOn(screen.getByTestId('where'), 300, 160);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
    dlg.remove();
  });

  it('鼠标拖动不切页（桌面行为不变）', () => {
    renderShell('/records');
    swipeOn(screen.getByTestId('where'), 300, 160, { pointerType: 'mouse' });
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });
});
