import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { clearAllCaches } from '../src/lib/studentCache.js';

// 今天 / 洞察的「待补填」入口链接到 /records?tab=pending：记录页应直接打开「待补填」tab
function renderAt(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Learning />
    </MemoryRouter>
  );
}

describe('记录页 ?tab= 参数', () => {
  beforeEach(() => {
    clearAllCaches();
    supabase.__resetMocks();
    setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
    setAuthProfile({ id: 'test-user-1', role: 1, full_name: '测试用户' });
    supabase.__setTableData('courses', []);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);
  });

  it('?tab=pending 打开「待补填」', async () => {
    renderAt('/records?tab=pending');
    expect(await screen.findByRole('tab', { name: /待补填/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('?tab=scores 打开「考试」', async () => {
    renderAt('/records?tab=scores');
    expect(await screen.findByRole('tab', { name: /考试/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('没有或未知的 tab 仍默认「全部」', async () => {
    renderAt('/records?tab=nope');
    expect(await screen.findByRole('tab', { name: /全部/ })).toHaveAttribute('aria-selected', 'true');
  });
});
