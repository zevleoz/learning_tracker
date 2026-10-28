import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import Mentor from '../src/pages/Mentor';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth.js';
import { toLocalDateStr } from '../src/lib/date.js';
import { formatMD } from '../src/components/mentor/fillInfo.js';

// 学生管理：今天 / 全部学生两个 tab、URL 即状态、点学生进数据分析、键盘。

const off = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return toLocalDateStr(d);
};
const at = (n) => `${off(n)}T12:00:00`;

let sid = 0;
const rec = (student_id, day, extra = {}) => ({
  id: `r${++sid}`, student_id, session_date: off(day), start_time: '16:00:00', end_time: '16:40:00',
  duration_minutes: 40, category: 1, form: '自主预习', eval_type: 1, self_rating: 80,
  grade_label: null, score: null, notes: null, deleted_at: null, created_at: at(day), course_id: null, ...extra,
});

function setup({ admin = true, extraConnections = [], drafts = [], mutes = [] } = {}) {
  const me = admin ? { id: 'admin-1', role: 3 } : { id: 'mentor-1', role: 2 };
  supabase.__setAuthState({ user: { id: me.id, email: 'x@test.com' }, session: { user: { id: me.id } } });
  setAuthUser({ id: me.id, email: 'x@test.com' });
  setAuthProfile({ id: me.id, role: me.role, full_name: '老师', default_workspace: 'tracker' });
  supabase.__setTableData('profiles', [
    { id: me.id, role: me.role, full_name: '老师' },
    { id: 's-a', role: 1, full_name: '首月未填', school_name: '学校A', created_at: at(-10) },  // 第 11 天
    { id: 's-b', role: 1, full_name: '首月已填', school_name: '学校A', created_at: at(-5) },     // 第 6 天
    { id: 's-gap', role: 1, full_name: '久未填', school_name: '学校B', created_at: '2024-01-01T00:00:00' },
    { id: 's-fine', role: 1, full_name: '正常', school_name: '学校B', created_at: '2024-01-02T00:00:00' },
  ]);
  const conn = (id, status = 1, alias = null) => ({ id: `c-${id}`, teacher_id: me.id, student_id: id, status, mentor_alias: alias, note: '' });
  supabase.__setTableData('teacher_student_connections', [
    conn('s-a', 1, '首月未填(Angela)'), conn('s-b', 1, '首月已填(Angela)'),
    conn('s-gap', 1, '久未填(Angela)'), conn('s-fine', 1, '正常(Jason)'),
    ...extraConnections,
  ]);
  supabase.__setTableData('learning_sessions', [
    rec('s-a', -3),
    rec('s-b', -1), rec('s-b', 0),
    rec('s-gap', -5), rec('s-gap', -5, { category: 3 }), rec('s-gap', -6, { category: 3 }),
    rec('s-fine', 0), rec('s-fine', -1),
  ]);
  supabase.__setTableData('supervision_drafts', drafts);
  supabase.__setTableData('supervision_mutes', mutes);
}

const draft = (over = {}) => ({
  id: 'd1', student_id: 's-b', kind: 'daily', period_start: off(-1), period_end: off(-1),
  body: '数学二次函数那节，你把例题抄了一遍。', edited_body: null, evidence: [], model: 'm',
  status: 'draft', handled_by: null, handled_at: null, snooze_until: null, skip_reason: null,
  meta: { why: '昨天记了 1 条：数学', facts: ['昨天记了 1 条：数学'], alts: [] },
  created_at: at(0), ...over,
});

function UrlProbe() {
  const loc = useLocation();
  const nav = useNavigate();
  return (
    <>
      <span data-testid="url">{loc.pathname + loc.search}</span>
      <button type="button" onClick={() => nav(-1)}>后退</button>
      <button type="button" onClick={() => nav(1)}>前进</button>
    </>
  );
}

const renderPage = (path = '/mentor', index = 0) => {
  const entries = Array.isArray(path) ? path : [path];
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Mentor />
      <UrlProbe />
    </MemoryRouter>,
  );
};
const url = () => screen.getByTestId('url').textContent;
const rowOf = (name) => screen.getByText(name).closest('tr');
const updates = (table) => supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === table);

async function readyList() {
  await waitFor(() => expect(document.querySelector('.mt-table')).not.toBeNull());
  await waitFor(() => expect(screen.getAllByText(/首月 · 第 11 天/).length).toBeGreaterThan(0));
}

async function readyToday() {
  await waitFor(() => expect(screen.getAllByText('首月未填').length).toBeGreaterThan(0));
}

beforeEach(() => {
  supabase.__resetMocks();
  try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
  sid = 0;
});

describe('学生管理 · 今天 tab', () => {
  it('默认进全部学生；?tab=today 进今天', async () => {
    setup();
    renderPage();
    await readyList();
    expect(screen.getByRole('tab', { name: /全部学生/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('今天：日期、抬头、待发卡片、这周谁记了', async () => {
    setup({ drafts: [draft()] });
    renderPage('/mentor?tab=today');
    await waitFor(() => expect(screen.getByText('今天有 1 条消息要发')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /今天/ })).toHaveAttribute('aria-selected', 'true');
    const queue = await screen.findByRole('region', { name: '待发消息' });
    expect(within(queue).getByText('数学二次函数那节，你把例题抄了一遍。')).toBeInTheDocument();
    expect(within(queue).getByText('每日表扬')).toBeInTheDocument();
    expect(within(queue).getByText('昨天记了 1 条：数学')).toBeInTheDocument();
    await readyToday();
    expect(screen.getByRole('region', { name: '这周谁记了' })).toBeInTheDocument();
  });

  it('没有待发消息时显示「今天的消息都处理完了」', async () => {
    setup();
    renderPage('/mentor?tab=today');
    await waitFor(() => expect(screen.getByText('今天的消息都处理完了')).toBeInTheDocument());
    const queue = screen.getByRole('region', { name: '待发消息' });
    expect(within(queue).getByText('没有待发的消息。')).toBeInTheDocument();
  });

  it('复制即已发，可撤销', async () => {
    setup({ drafts: [draft()] });
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage('/mentor?tab=today');
    const queue = await screen.findByRole('region', { name: '待发消息' });
    fireEvent.click(await within(queue).findByRole('button', { name: '复制' }));
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(1));
    expect(updates('supervision_drafts')[0].args.status).toBe('sent');
    await waitFor(() => expect(within(queue).getByText(/已复制给/)).toBeInTheDocument());
    fireEvent.click(within(queue).getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(2));
    expect(updates('supervision_drafts')[1].args.status).toBe('draft');
  });

  it('不用发：折叠行给出原因，可撤销', async () => {
    setup({ drafts: [draft()] });
    renderPage('/mentor?tab=today');
    const queue = await screen.findByRole('region', { name: '待发消息' });
    fireEvent.click(await within(queue).findByRole('button', { name: '不用发' }));
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(1));
    expect(updates('supervision_drafts')[0].args.status).toBe('skipped');
    await waitFor(() => expect(within(queue).getByRole('button', { name: '当面说过了' })).toBeInTheDocument());
    fireEvent.click(within(queue).getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(2));
  });

  it('点卡片里的学生名直接进数据分析，没有弹窗', async () => {
    setup({ drafts: [draft()] });
    renderPage('/mentor?tab=today');
    const queue = await screen.findByRole('region', { name: '待发消息' });
    fireEvent.click(await within(queue).findByRole('button', { name: '首月已填' }));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-b'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('点「这周谁记了」里的学生同样进数据分析', async () => {
    setup();
    renderPage('/mentor?tab=today');
    const board = await screen.findByRole('region', { name: '这周谁记了' });
    await waitFor(() => expect(within(board).getAllByText('久未填').length).toBeGreaterThan(0));
    fireEvent.click(within(board).getByRole('button', { name: '久未填' }));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-gap'));
  });
});

describe('学生管理 · 隐藏 / 暂停', () => {
  const boardRegion = () => screen.findByRole('region', { name: '这周谁记了' });

  it('隐藏的学生从主列表移入「已隐藏」，恢复后立即回来', async () => {
    setup({ mutes: [{ student_id: 's-gap', mode: 'hidden', until: null, set_by: 'admin-1' }] });
    renderPage('/mentor?tab=today');
    await readyToday();
    const board = await boardRegion();
    const toggle = await within(board).findByRole('button', { name: '已隐藏 1 人' });
    expect(within(board).queryByRole('button', { name: '久未填' })).toBeNull();

    fireEvent.click(toggle);
    fireEvent.click(await within(board).findByRole('button', { name: '恢复' }));

    await waitFor(() => expect(within(board).getByRole('button', { name: '久未填' })).toBeInTheDocument());
    const deletes = supabase.__getCallHistory()
      .filter((c) => c.method === 'delete' && c.table === 'supervision_mutes');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args).toEqual([{ type: 'eq', field: 'student_id', value: 's-gap' }]);
  });

  it('⋯ 菜单可以隐藏；右键菜单可以暂停 5 天，行上显示「再看」', async () => {
    setup();
    renderPage('/mentor?tab=today');
    await readyToday();
    const board = await boardRegion();
    const row = within(board).getByRole('button', { name: '久未填' }).closest('tr');

    fireEvent.click(within(row).getByRole('button', { name: '更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /隐藏/ }));

    await waitFor(() => {
      const save = supabase.__getCallHistory().find((c) => c.method === 'upsert' && c.table === 'supervision_mutes');
      expect(save.args).toMatchObject({ student_id: 's-gap', mode: 'hidden', until: null, set_by: 'admin-1' });
    });
    await waitFor(() => expect(within(board).getByRole('button', { name: '已隐藏 1 人' })).toBeInTheDocument());

    // 恢复 → 用右键菜单暂停 5 天
    fireEvent.click(within(board).getByRole('button', { name: '已隐藏 1 人' }));
    fireEvent.click(within(board).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(within(board).getByRole('button', { name: '久未填' })).toBeInTheDocument());

    const again = within(board).getByRole('button', { name: '久未填' }).closest('tr');
    fireEvent.contextMenu(again);
    fireEvent.click(screen.getByRole('menuitem', { name: /暂停 5 天/ }));

    await waitFor(() => {
      const saves = supabase.__getCallHistory().filter((c) => c.method === 'upsert' && c.table === 'supervision_mutes');
      expect(saves[saves.length - 1].args).toMatchObject({ student_id: 's-gap', mode: 'snoozed', until: off(5) });
    });
    await waitFor(() => expect(within(board).getByText(/再看：/)).toBeInTheDocument());
  });

  it('暂停到期（until < 今天）自动回到主列表', async () => {
    setup({ mutes: [{ student_id: 's-gap', mode: 'snoozed', until: off(-1) }] });
    renderPage('/mentor?tab=today');
    await readyToday();
    const board = await boardRegion();
    await waitFor(() => expect(within(board).getByRole('button', { name: '久未填' })).toBeInTheDocument());
    expect(within(board).queryByText(/已隐藏/)).toBeNull();
  });

  it('隐藏学生今天的草稿不出现在待发队列，抬头也不计数', async () => {
    setup({
      drafts: [draft({ student_id: 's-gap' })],
      mutes: [{ student_id: 's-gap', mode: 'hidden', until: null }],
    });
    renderPage('/mentor?tab=today');
    await waitFor(() => expect(screen.getByText('今天的消息都处理完了')).toBeInTheDocument());
    const queue = screen.getByRole('region', { name: '待发消息' });
    expect(within(queue).getByText('没有待发的消息。')).toBeInTheDocument();
    expect(screen.queryByText('数学二次函数那节，你把例题抄了一遍。')).toBeNull();
  });
});

describe('学生管理 · 全部学生 tab', () => {
  it('tab 写进 URL；列表显示阶段、近 7 天、最后记录、连接', async () => {
    setup();
    renderPage('/mentor?tab=today');
    await readyToday();
    fireEvent.click(screen.getByRole('tab', { name: /全部学生/ }));
    await waitFor(() => expect(url()).toBe('/mentor'));
    await readyList();

    const miss = within(rowOf('首月未填'));
    expect(miss.getByText('首月 · 第 11 天')).toBeInTheDocument();
    expect(miss.getByText(`${formatMD(off(-3))} · 3 天前`)).toBeInTheDocument();
    expect(miss.getByText('1/7')).toBeInTheDocument();
    expect(miss.getByText('已连接')).toBeInTheDocument();

    const ok = within(rowOf('首月已填'));
    expect(ok.getByText('首月 · 第 6 天')).toBeInTheDocument();
    expect(ok.getByText('2/7')).toBeInTheDocument();
    expect(ok.queryByText(/天没填/)).toBeNull();
  });

  it('顾问分组头只显示人数，不再有红色计数', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    const head = document.querySelector('.mt-group-toggle');
    expect(head.textContent).toContain('Angela');
    expect(head.textContent).toContain('3 人');
    expect(head.textContent).not.toContain('昨天没填');
    expect(head.textContent).not.toContain('3 天以上没填');
  });

  it('组内顺序：首月在前，其次没填天数多的', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    const names = [...document.querySelectorAll('.mt-group')][0].querySelectorAll('.mt-name');
    expect([...names].map((n) => n.textContent)).toEqual(['首月未填', '首月已填', '久未填']);
  });

  it('列表 / 卡片切换并记住选择', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    expect(document.querySelector('.mt-table')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '卡片' }));
    expect(document.querySelector('.mt-table')).toBeNull();
    expect(document.querySelector('.mentor-student-card')).not.toBeNull();
    expect(localStorage.getItem('mentor.students.view')).toBe('cards');
    expect(screen.getAllByText('第 11 天').length).toBeGreaterThan(0);
  });

  it('搜索可以按学校', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.change(screen.getByPlaceholderText('搜索学生、备注、学校'), { target: { value: '学校B' } });
    await waitFor(() => expect(screen.queryByText('首月未填')).toBeNull());
    expect(screen.getByText('久未填')).toBeInTheDocument();
  });

  it('备注名可以原地修改', async () => {
    setup();
    supabase.__setRpcResponse('update_student_alias', { data: null, error: null });
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.click(within(rowOf('首月未填')).getByRole('button', { name: '改备注' }));
    const input = await screen.findByPlaceholderText('输入备注名（留空清除）');
    fireEvent.change(input, { target: { value: '小满(Angela)' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      const calls = supabase.__getCallHistory().filter((c) => c.method === 'rpc' && c.table === 'update_student_alias');
      expect(calls.length).toBe(1);
      expect(calls[0].args.p_alias).toBe('小满(Angela)');
      expect(calls[0].args.p_student_id).toBe('s-a');
    });
  });

  it('管理员可以在行菜单里删除学生', async () => {
    setup();
    supabase.__setRpcResponse('delete_student', { data: 's-a', error: null });
    renderPage('/mentor?tab=all');
    await readyList();
    const row = within(rowOf('首月未填'));
    fireEvent.click(row.getByRole('button', { name: '更多操作' }));
    fireEvent.click(row.getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.getByText('永久删除学生')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await waitFor(() => {
      const calls = supabase.__getCallHistory().filter((c) => c.method === 'rpc' && c.table === 'delete_student');
      expect(calls.length).toBe(1);
      expect(calls[0].args.p_student_id).toBe('s-a');
    });
  });
});

describe('学生管理 · 键盘', () => {
  it('J/K 移动，Enter 进数据分析', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.keyDown(window, { key: 'j' });
    expect(rowOf('首月未填').className).toContain('is-selected');
    fireEvent.keyDown(window, { key: 'j' });
    expect(rowOf('首月已填').className).toContain('is-selected');
    fireEvent.keyDown(window, { key: 'k' });
    expect(rowOf('首月未填').className).toContain('is-selected');
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-a'));
  });

  it('输入框里不触发快捷键，「/」聚焦搜索', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    const search = screen.getByPlaceholderText('搜索学生、备注、学校');
    fireEvent.keyDown(search, { key: 'j' });
    expect(document.querySelector('.mt-row.is-selected')).toBeNull();
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(search);
  });
});

describe('学生管理 · URL 即状态', () => {
  it('点学生入栈；后退回到全部学生', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.click(screen.getByText('首月未填'));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-a'));
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(url()).toBe('/mentor?tab=all'));
    expect(document.querySelector('.mt-table')).not.toBeNull();
  });

  it('前进回到刚才的数据分析', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.click(screen.getByText('首月未填'));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-a'));
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(url()).toBe('/mentor?tab=all'));
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-a'));
  });

  it('侧栏切换视图入栈，后退回原来的 tab', async () => {
    setup();
    renderPage('/mentor?tab=all');
    await readyList();
    fireEvent.click(screen.getByRole('button', { name: '数据分析' }));
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics'));
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(url()).toBe('/mentor?tab=all'));
    await readyList();
  });

  it('数据分析的学生下拉是替换，不新增历史', async () => {
    setup();
    renderPage(['/mentor?tab=all', '/mentor?view=analytics&student=s-a'], 1);
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-a'));
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 's-fine' } });
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-fine'));
    fireEvent.click(screen.getByRole('button', { name: '后退' }));
    await waitFor(() => expect(url()).toBe('/mentor?tab=all'));
  });

  it('/mentor?student=<id> 落到数据分析', async () => {
    setup();
    renderPage('/mentor?student=s-gap');
    await waitFor(() => expect(url()).toBe('/mentor?view=analytics&student=s-gap'));
    await waitFor(() => expect(screen.getAllByText('久未填').length).toBeGreaterThan(0));
    // 没有草稿、没有历史时面板只留一行
    expect(await screen.findByText('还没有给这位学生的消息。')).toBeInTheDocument();
  });

  it('数据分析顶部有这位学生的消息面板和复习报告', async () => {
    setup({ drafts: [draft()] });
    renderPage('/mentor?view=analytics&student=s-b');
    const panel = await screen.findByRole('region', { name: '这位学生的消息' });
    expect(within(panel).getByText('今天的消息')).toBeInTheDocument();
    expect(within(panel).getByText('数学二次函数那节，你把例题抄了一遍。')).toBeInTheDocument();
    expect(within(panel).getByText('发过的消息')).toBeInTheDocument();
  });
});

describe('再次邀请', () => {
  it('mentor_reinvite 成功后补发 /api/notify {type:"reinvite"}', async () => {
    setup({
      admin: false,
      extraConnections: [{ id: 'c-x', teacher_id: 'mentor-1', student_id: 's-gap', status: 2, mentor_alias: null, note: '' }],
    });
    // 让 s-gap 的连接是「已拒绝」
    supabase.__setTableData('teacher_student_connections', supabase.__getTableData('teacher_student_connections')
      .filter((c) => !(c.student_id === 's-gap' && c.id !== 'c-x'))
      .map((c) => ({ ...c, teacher_id: 'mentor-1' })));
    supabase.__setRpcResponse('mentor_reinvite', { data: null, error: null });
    const fetchMock = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock;
    renderPage('/mentor?tab=all');
    await waitFor(() => expect(screen.getAllByText('久未填').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: '再次邀请' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [fetchUrl, opts] = fetchMock.mock.calls[0];
    expect(fetchUrl).toBe('/api/notify');
    expect(JSON.parse(opts.body)).toEqual({ type: 'reinvite', student_id: 's-gap' });
    expect(opts.headers.Authorization).toMatch(/^Bearer /);
    const calls = supabase.__getCallHistory().filter((c) => c.method === 'rpc' && c.table === 'mentor_reinvite');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_student).toBe('s-gap');
  });
});
