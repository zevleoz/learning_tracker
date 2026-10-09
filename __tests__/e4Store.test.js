import { listTrackerStudents, createE4Student } from '../src/lib/e4Store.js';
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

// R1 回归：建档时 Y4 关联曾被固定白名单丢掉，导致「没当场生成报告」的学生回到未关联状态
describe('createE4Student 落库 Y4 关联（R1）', () => {
  const lastInsert = () =>
    supabase.__getCallHistory().reverse()
      .find((c) => c.method === 'insert' && c.table === 'e4_students')?.args;

  beforeEach(() => {
    supabase.__resetMocks();
  });

  it('传入的四个 y4_* 字段原样写入', async () => {
    await createE4Student({
      display_name: 'Sean',
      created_by: 'u-1',
      y4_student_id: 48,
      y4_report_id: 46,
      y4_student_name: 'Sean',
      y4_report_date: '2026-10-08',
    });
    expect(lastInsert()).toMatchObject({
      display_name: 'Sean',
      y4_student_id: 48,
      y4_report_id: 46,
      y4_student_name: 'Sean',
      y4_report_date: '2026-10-08',
    });
  });

  it('只带 Y4 学生（稍后选报告）时，不写入报告字段', async () => {
    await createE4Student({ display_name: 'Sean', y4_student_id: 48, y4_student_name: 'Sean' });
    const row = lastInsert();
    expect(row.y4_student_id).toBe(48);
    expect(row).not.toHaveProperty('y4_report_id');
  });

  it('完全不涉及 Y4 时保持原样（不产生多余列）', async () => {
    await createE4Student({ display_name: '仅名字建档' });
    const row = lastInsert();
    expect(row.display_name).toBe('仅名字建档');
    expect(row).not.toHaveProperty('y4_student_id');
    expect(row).not.toHaveProperty('y4_report_id');
  });
});