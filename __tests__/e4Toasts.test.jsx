import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import E4Layout from '../src/components/E4Layout.jsx';
import { toast } from '../src/lib/toast.js';

jest.mock('../src/lib/e4Store.js', () => ({
  listE4Students: jest.fn(() => Promise.resolve([])),
  updateWorkspace: jest.fn(() => Promise.resolve()),
}));
jest.mock('../src/lib/e4Recent.js', () => ({
  getRecentStudents: () => [],
  subscribeRecent: () => () => {},
}));

describe('E4 外壳显示 toast', () => {
  test('E4 页面里 toast() 的失败提示能看到（之前没挂容器，AI 预填失败时页面毫无反应）', async () => {
    render(
      <MemoryRouter initialEntries={['/e4']}>
        <Routes>
          <Route element={<E4Layout />}>
            <Route path="/e4" element={<div>页面</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    act(() => { toast('LLM 接口返回错误（HTTP 401）', { kind: 'error' }); });
    expect(await screen.findByText('LLM 接口返回错误（HTTP 401）')).toHaveClass('toast', 'error');
  });
});
