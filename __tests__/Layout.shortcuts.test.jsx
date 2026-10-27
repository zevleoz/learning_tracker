import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Layout from '../src/components/Layout.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

function Where() {
  const l = useLocation();
  return (
    <div>
      <div data-testid="where">{l.pathname + l.search}</div>
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

function press(key, target = document.body, init = {}) {
  fireEvent.keyDown(target, { key, ...init });
}

let openLog;
let closeLog;
const onOpen = () => openLog();
const onClose = () => closeLog();

beforeEach(() => {
  supabase.__resetMocks();
  setAuthUser({ id: 'u1' });
  setAuthProfile({ id: 'u1', role: 1, full_name: '陈一舟' });
  supabase.__setTableData('teacher_student_connections', []);
  openLog = jest.fn();
  closeLog = jest.fn();
  window.addEventListener('yb:open-log', onOpen);
  window.addEventListener('yb:close-log', onClose);
});
afterEach(() => {
  window.removeEventListener('yb:open-log', onOpen);
  window.removeEventListener('yb:close-log', onClose);
});

describe('Layout · 导航', () => {
  it('学生端导航：今天 · 记录 · 洞察 · 我的，指向新路径', () => {
    renderShell('/today');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    const links = Array.from(nav.querySelectorAll('a.yb-tab'));
    expect(links.map((a) => a.querySelector('.yb-tab-label').textContent)).toEqual(['今天', '记录', '洞察', '我的']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/today', '/records', '/insights', '/me']);
    expect(screen.getByRole('button', { name: '记一下' })).toBeInTheDocument();
  });

  it('高亮：/learning 算记录，/me/courses 算我的', () => {
    const { unmount } = renderShell('/learning');
    expect(screen.getByRole('link', { name: /记录/ })).toHaveAttribute('aria-current', 'page');
    unmount();
    renderShell('/me/courses');
    expect(screen.getByRole('link', { name: /我的/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /记录/ })).not.toHaveAttribute('aria-current');
  });

  it('待处理邀请的角标挂在「我的」上，不再挂在通知上', async () => {
    supabase.__setTableData('teacher_student_connections', [
      { id: 'k1', teacher_id: 't1', student_id: 'u1', status: 0 },
      { id: 'k2', teacher_id: 't2', student_id: 'u1', status: 1 },
    ]);
    renderShell('/today');
    const me = await screen.findByRole('link', { name: '我的，1 条待处理邀请' });
    expect(me.querySelector('.yb-badge')).toHaveTextContent('1');
    expect(screen.queryByText('通知')).not.toBeInTheDocument();
  });

  it('＋ 在记录页发出 yb:open-log，在其它页跳转到 /records?log=1', () => {
    const { unmount } = renderShell('/records');
    fireEvent.click(screen.getByRole('button', { name: '记一下' }));
    expect(openLog).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
    unmount();

    renderShell('/today');
    fireEvent.click(screen.getByRole('button', { name: '记一下' }));
    expect(openLog).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/records?log=1');
  });
});

describe('Layout · 桌面快捷键', () => {
  it('N：在记录页打开记一下，在其它页跳转到 /records?log=1', () => {
    const { unmount } = renderShell('/learning');
    press('n');
    expect(openLog).toHaveBeenCalledTimes(1);
    unmount();

    renderShell('/me');
    press('N');
    expect(screen.getByTestId('where')).toHaveTextContent('/records?log=1');
  });

  it('1–4 切换页面', () => {
    renderShell('/me');
    press('1');
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
    press('2');
    expect(screen.getByTestId('where')).toHaveTextContent('/records');
    press('3');
    expect(screen.getByTestId('where')).toHaveTextContent('/insights');
    press('4');
    expect(screen.getByTestId('where')).toHaveTextContent('/me');
    press('5');
    expect(screen.getByTestId('where')).toHaveTextContent('/me');
  });

  it('Esc 通过 yb:close-log 关闭面板', () => {
    renderShell('/records');
    press('Escape');
    expect(closeLog).toHaveBeenCalledTimes(1);
  });

  it('在输入框里打字时忽略 N 和数字', () => {
    renderShell('/today');
    const input = screen.getByLabelText('备注');
    input.focus();
    press('n', input);
    press('2', input);
    expect(openLog).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
  });

  it('带修饰键（⌘/Ctrl/Alt）或已有弹层时不触发', () => {
    renderShell('/today');
    press('2', document.body, { metaKey: true });
    press('n', document.body, { ctrlKey: true });
    expect(screen.getByTestId('where')).toHaveTextContent('/today');

    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    press('3');
    expect(screen.getByTestId('where')).toHaveTextContent('/today');
    dlg.remove();
  });

  it('老师账号在最前多一个「导师」入口', async () => {
    setAuthProfile({ id: 'u1', role: 2, full_name: '李老师' });
    renderShell('/today');
    await waitFor(() => expect(screen.getByRole('link', { name: /导师/ })).toHaveAttribute('href', '/mentor'));
  });

  it('导师台 /mentor（含末尾斜杠）不套学生外壳，也不响应 N、数字快捷键', async () => {
    setAuthProfile({ id: 'u1', role: 2, full_name: '李老师' });
    for (const path of ['/mentor', '/mentor/']) {
      const { unmount } = renderShell(path);
      expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
      press('n');
      press('2');
      expect(screen.getByTestId('where')).toHaveTextContent(path);
      expect(openLog).not.toHaveBeenCalled();
      unmount();
    }
  });
});
