import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Learning from '../src/pages/Learning';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { clearAllCaches } from '../src/lib/studentCache.js';

// 记一下的章节 / 单元下拉要和「我的课程」一样按 order_idx 排，而不是按数据库返回的顺序
describe('记一下：章节 / 单元按 order_idx 排序', () => {
  beforeEach(() => {
    clearAllCaches();
    supabase.__resetMocks();
    setAuthUser({ id: 'test-user-1', email: 'test@example.com' });
    setAuthProfile({ id: 'test-user-1', role: 1, full_name: '测试用户' });
    supabase.__setTableData('courses', [{
      id: 'c1', name: '数学', subject: '', course_type: 1, created_by: 'test-user-1', deleted_at: null,
      // 数据库返回顺序与 order_idx 不一致（例如第一章改过名后行被挪到了后面）
      chapters: [
        { id: 'ch2', name: '第二章', order_idx: 2, deleted_at: null, units: [] },
        { id: 'ch1', name: '第一章', order_idx: 1, deleted_at: null, units: [
          { id: 'u2', name: '单元二', order_idx: 2, deleted_at: null },
          { id: 'u1', name: '单元一', order_idx: 1, deleted_at: null },
        ] },
      ],
    }]);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('user_learning_forms', []);
  });

  it('查询带 order_idx，下拉按 order_idx 排序', async () => {
    render(<MemoryRouter><Learning /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '记一下' }));
    const chapterSelect = await waitFor(() => screen.getByRole('combobox', { name: '章节' }));
    const chapterNames = within(chapterSelect).getAllByRole('option').map((o) => o.textContent);
    expect(chapterNames).toEqual(['不选章节', '第一章', '第二章']);

    fireEvent.change(chapterSelect, { target: { value: 'ch1' } });
    const unitNames = within(screen.getByRole('combobox', { name: '单元' })).getAllByRole('option').map((o) => o.textContent);
    expect(unitNames).toEqual(['整章', '单元一', '单元二']);

    const courseSelect = supabase.__getCallHistory().find((c) => c.method === 'select' && c.table === 'courses');
    expect(courseSelect.args.fields).toMatch(/chapters\(id, name, order_idx/);
    expect(courseSelect.args.fields).toMatch(/units\(id, name, order_idx/);
  });
});
