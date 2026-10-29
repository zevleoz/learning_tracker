import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Layout from '../src/components/Layout.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
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

// jsdom 没有 matchMedia / PointerEvent：补最小实现，让底栏形态与 pointer 事件可用
beforeAll(() => {
  window.matchMedia = (query) => ({
    matches: query.includes('max-width: 599px'),
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

function tab(label) {
  return screen.getByRole('link', { name: label });
}

describe('Layout · 3a 底栏指下滑动', () => {
  it('从「今天」滑到「洞察」抬起 → 切到洞察，并高亮跟手', () => {
    renderShell('/today');
    const today = tab('今天');
    const insights = tab('洞察');

    fireEvent.pointerDown(today, { pointerType: 'touch', clientX: 60, clientY: 730 });
    fireEvent.pointerMove(insights, { pointerType: 'touch', clientX: 300, clientY: 730 });

    expect(insights).toHaveClass('is-scrub');
    expect(today).not.toHaveClass('is-scrub');

    fireEvent.pointerUp(insights, { pointerType: 'touch', clientX: 300, clientY: 730 });
    expect(screen.getByTestId('where')).toHaveTextContent('/insights');
    expect(insights).toHaveClass('on');
    expect(insights).not.toHaveClass('is-scrub');
  });

  it('纯点击（没有移动）保持原来的跳转行为', () => {
    renderShell('/today');
    const records = tab('记录');
    fireEvent.pointerDown(records, { pointerType: 'touch', clientX: 150, clientY: 730 });
    fireEvent.pointerUp(records, { pointerType: 'touch', clientX: 150, clientY: 730 });
    expect(records).not.toHaveClass('is-scrub');
    // 浏览器随后补发 click，由 <Link> 自己处理
    fireEvent.click(records);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
  });

  it('鼠标按压滑动不触发（桌面行为不变）', () => {
    renderShell('/today');
    const today = tab('今天');
    const insights = tab('洞察');
    fireEvent.pointerDown(today, { pointerType: 'mouse', clientX: 60, clientY: 730 });
    fireEvent.pointerMove(insights, { pointerType: 'mouse', clientX: 300, clientY: 730 });
    fireEvent.pointerUp(insights, { pointerType: 'mouse', clientX: 300, clientY: 730 });
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
    expect(insights).not.toHaveClass('is-scrub');
  });
});
