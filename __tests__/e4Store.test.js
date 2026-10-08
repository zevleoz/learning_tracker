import { listTrackerStudents } from '../src/lib/e4Store.js';
import { supabase } from '../src/__mocks__/supabase.js';

function ilikeFilterOfLastProfilesQuery() {
  const call = supabase.__getCallHistory()
    .reverse()
    .find((c) => c.method === 'select' && c.table === 'profiles');
  return call?.args?.filters?.find((f) => f.type === 'ilike');
}

describe('listTrackerStudents 的 ilike 转义（BUG-6）', () => {
  beforeEach(() => {
    supabase.__resetMocks();
  });

  it('普通关键词直接做包含匹配', async () => {
    supabase.__setTableData('profiles', [
      { id: 's1', full_name: '李小明', role: 1 },
      { id: 's2', full_name: '王大力', role: 1 },
    ]);
    const rows = await listTrackerStudents('李');
    expect(rows.map((r) => r.full_name)).toEqual(['李小明']);
    expect(ilikeFilterOfLastProfilesQuery().value).toBe('%李%');
  });

  it('% 与 _ 被转义，不再当作通配符', async () => {
    await listTrackerStudents('50%_x');
    expect(ilikeFilterOfLastProfilesQuery().value).toBe('%50\\%\\_x%');
  });

  it('反斜杠同样被转义', async () => {
    await listTrackerStudents('a\\b');
    expect(ilikeFilterOfLastProfilesQuery().value).toBe('%a\\\\b%');
  });

  it('空关键词不加 ilike 条件', async () => {
    await listTrackerStudents('');
    expect(ilikeFilterOfLastProfilesQuery()).toBeUndefined();
  });
});