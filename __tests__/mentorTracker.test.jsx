import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Mentor from '../src/pages/Mentor';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth.js';
import { toLocalDateStr } from '../src/lib/date.js';
import { formatMD } from '../src/components/mentor/fillInfo.js';

// 学生管理：列表视图的填写情况、今日反馈、键盘、?student= 打开侧栏、再次邀请推送

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

function setup({ admin = true, extraConnections = [], drafts = [] } = {}) {
  const me = admin ? { id: 'admin-1', role: 3 } : { id: 'mentor-1', role: 2 };
  supabase.__setAuthState({ user: { id: me.id, email: 'x@test.com' }, session: { user: { id: me.id } } });
  setAuthUser({ id: me.id, email: 'x@test.com' });
  setAuthProfile({ id: me.id, role: me.role, full_name: '老师', default_workspace: 'tracker' });
  supabase.__setTableData('profiles', [
    { id: me.id, role: me.role, full_name: '老师' },
    { id: 's-new-miss', role: 1, full_name: '新生未填', school_name: '学校A', created_at: at(-10) },  // 第 11 天
    { id: 's-new-ok', role: 1, full_name: '新生已填', school_name: '学校A', created_at: at(-5) },     // 第 6 天
    { id: 's-gap', role: 1, full_name: '久未填', school_name: '学校B', created_at: '2024-01-01T00:00:00' },
    { id: 's-fine', role: 1, full_name: '正常', school_name: '学校B', created_at: '2024-01-02T00:00:00' },
  ]);
  const conn = (id, status = 1, alias = null) => ({ id: `c-${id}`, teacher_id: me.id, student_id: id, status, mentor_alias: alias, note: '' });
  supabase.__setTableData('teacher_student_connections', [
    conn('s-new-miss', 1, '新生未填(Angela)'), conn('s-new-ok', 1, '新生已填(Angela)'),
    conn('s-gap', 1, '久未填(Angela)'), conn('s-fine', 1, '正常(Jason)'),
    ...extraConnections,
  ]);
  supabase.__setTableData('learning_sessions', [
    rec('s-new-miss', -3),
    rec('s-new-ok', -1), rec('s-new-ok', 0),
    rec('s-gap', -5), rec('s-gap', -5, { category: 3 }), rec('s-gap', -6, { category: 3 }),
    rec('s-fine', 0), rec('s-fine', -1),
  ]);
  supabase.__setTableData('supervision_drafts', drafts);
}

const draft = (over = {}) => ({
  id: 'd1', student_id: 's-new-ok', kind: 'daily', period_start: off(-1), period_end: off(-1),
  body: '数学二次函数那节，你把例题抄了一遍。', edited_body: null, evidence: [], model: 'm',
  status: 'draft', handled_by: null, handled_at: null, created_at: at(0), ...over,
});

const renderPage = (path = '/mentor') => render(<MemoryRouter initialEntries={[path]}><Mentor /></MemoryRouter>);
const rowOf = (name) => screen.getByText(name).closest('tr');
const updates = (table) => supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === table);

async function ready() {
  await waitFor(() => expect(screen.getAllByText('新生未填').length).toBeGreaterThan(0));
  // 填写情况加载完成后才会出现阶段标签
  await waitFor(() => expect(screen.getAllByText(/新生 · 第 11 天/).length).toBeGreaterThan(0));
}

beforeEach(() => {
  supabase.__resetMocks();
  try { localStorage.clear(); } catch (_) { /* ignore */ }
  sid = 0;
});

describe('学生管理 · 列表视图', () => {
  it('页面标题栏已移除', async () => {
    setup();
    renderPage();
    await ready();
    expect(screen.queryByText('管理你的学生连接和查看学习数据')).toBeNull();
  });

  it('每行显示阶段 / 需关注 / 最后记录 / 待补填', async () => {
    setup();
    renderPage();
    await ready();

    const miss = within(rowOf('新生未填'));
    expect(miss.getByText('新生 · 第 11 天')).toBeInTheDocument();
    expect(miss.getByText('昨天没填')).toBeInTheDocument();
    expect(miss.getByText(`${formatMD(off(-3))} · 3 天前`)).toBeInTheDocument();

    const ok = within(rowOf('新生已填'));
    expect(ok.getByText('新生 · 第 6 天')).toBeInTheDocument();
    expect(ok.getByText('昨天填了')).toBeInTheDocument();
    expect(ok.getByText('2/7')).toBeInTheDocument();

    const gap = within(rowOf('久未填'));
    expect(gap.getByText('每周')).toBeInTheDocument();
    expect(gap.getByText('5 天没填')).toBeInTheDocument();
    expect(gap.getByText('2')).toBeInTheDocument(); // 待补填：两条练习没有等第

    const fine = within(rowOf('正常'));
    expect(fine.queryByText(/天没填/)).toBeNull();
    expect(fine.getByText('2/7')).toBeInTheDocument();
  });

  it('近 7 天方块：今天虚线，有记录的实心，title 是日期', async () => {
    setup();
    renderPage();
    await ready();
    const strip = within(rowOf('新生已填')).getByRole('img', { name: '近 7 天 2/7' });
    const squares = strip.querySelectorAll('.fs-sq');
    expect(squares).toHaveLength(7);
    expect(squares[6].className).toContain('is-today');
    expect(squares[6].className).toContain('is-filled');
    expect(squares[5].className).toContain('is-filled');
    expect(squares[4].className).not.toContain('is-filled');
    expect(squares[5].getAttribute('title')).toBe(off(-1));
  });

  it('顾问分组头：人数 + 新生 + 新生昨天没填 + 3 天以上没填', async () => {
    setup();
    renderPage();
    await ready();
    const head = document.querySelector('.mt-group-toggle');
    expect(head.textContent).toContain('Angela');
    expect(head.textContent).toContain('3 人');
    expect(head.textContent).toContain('新生 2');
    expect(head.textContent).toContain('新生昨天没填 1');
    expect(head.textContent).toContain('3 天以上没填 1');
  });

  it('组内顺序：新生在前，其次没填天数多的', async () => {
    setup();
    renderPage();
    await ready();
    const names = [...document.querySelectorAll('.mt-group')][0].querySelectorAll('.mt-name');
    expect([...names].map((n) => n.textContent)).toEqual(['新生未填', '新生已填', '久未填']);
  });

  it('列表 / 卡片切换并记住选择', async () => {
    setup();
    renderPage();
    await ready();
    expect(document.querySelector('.mt-table')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '卡片' }));
    expect(document.querySelector('.mt-table')).toBeNull();
    expect(document.querySelector('.mentor-student-card')).not.toBeNull();
    expect(localStorage.getItem('mentor.students.view')).toBe('cards');
    // 新生卡片有第 N 天标签，不再出现「N 天未填写」
    expect(screen.getAllByText('第 11 天').length).toBeGreaterThan(0);
  });

  it('搜索可以按学校', async () => {
    setup();
    renderPage();
    await ready();
    fireEvent.change(screen.getByPlaceholderText('搜索学生、备注、学校'), { target: { value: '学校B' } });
    await waitFor(() => expect(screen.queryByText('新生未填')).toBeNull());
    expect(screen.getByText('久未填')).toBeInTheDocument();
  });
});

describe('学生管理 · 键盘与侧栏', () => {
  it('J/K 移动，Enter 打开侧栏，侧栏里 J 切到下一位', async () => {
    setup();
    renderPage();
    await ready();
    fireEvent.keyDown(window, { key: 'j' });
    expect(rowOf('新生未填').className).toContain('is-selected');
    fireEvent.keyDown(window, { key: 'j' });
    expect(rowOf('新生已填').className).toContain('is-selected');
    fireEvent.keyDown(window, { key: 'k' });
    expect(rowOf('新生未填').className).toContain('is-selected');

    fireEvent.keyDown(window, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('新生未填')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('新生已填')).toBeInTheDocument());
  });

  it('输入框里不触发快捷键，「/」聚焦搜索', async () => {
    setup();
    renderPage();
    await ready();
    const search = screen.getByPlaceholderText('搜索学生、备注、学校');
    fireEvent.keyDown(search, { key: 'j' });
    expect(document.querySelector('.mt-row.is-selected')).toBeNull();
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(search);
  });

  it('侧栏：三个统计 + 按日期分组的完整记录 + 待补填', async () => {
    setup();
    renderPage();
    await ready();
    fireEvent.click(screen.getByText('久未填'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('近 7 天有记录')).toBeInTheDocument());
    expect(within(dialog).getByText('待补填')).toBeInTheDocument();
    expect(within(dialog).getByText('最后记录')).toBeInTheDocument();
    expect(within(dialog).queryByText(/详细周度复盘/)).toBeNull();
    expect(within(dialog).getAllByText('客观 待补填').length).toBe(2);
    expect(within(dialog).getAllByText('16:00').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('16:40').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('主观 基本掌握').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: '前往数据分析' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '前往课表' })).toBeInTheDocument();
  });

  it('/mentor?student=<id> 直接打开这位学生的侧栏', async () => {
    setup();
    renderPage('/mentor?student=s-gap');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('久未填')).toBeInTheDocument();
  });
});

describe('今日反馈', () => {
  it('折叠成一行计数；没有任何内容时整块隐藏', async () => {
    setup({ drafts: [draft()] });
    renderPage();
    await ready();
    const strip = await screen.findByRole('region', { name: '今日反馈' });
    expect(strip.textContent).toContain('1 条待发');
    expect(strip.textContent).toContain('1 新生昨天没填');
    expect(strip.textContent).toContain('1 3 天以上没填');
  });

  it('草稿表不存在时只显示两份没填名单，不报错', async () => {
    setup();
    const realFrom = supabase.from;
    const missing = {
      select: () => missing, in: () => missing, eq: () => missing, gte: () => missing, order: () => missing, limit: () => missing,
      then: (resolve) => resolve({ data: null, error: { code: '42P01', message: 'relation "public.supervision_drafts" does not exist' } }),
    };
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => (t === 'supervision_drafts' ? missing : realFrom.call(supabase, t)));
    renderPage();
    await ready();
    const strip = await screen.findByRole('region', { name: '今日反馈' });
    await waitFor(() => expect(strip.textContent).toContain('新生昨天没填'));
    expect(strip.textContent).not.toContain('待发');
    fireEvent.click(within(strip).getByRole('button'));
    expect(screen.queryByRole('tab', { name: /待发/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /已发/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /新生昨天没填/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    spy.mockRestore();
  });

  it('T 展开；待发行显示姓名、顾问、类型、正文；点「已发」写入 sent', async () => {
    setup({ drafts: [draft()] });
    renderPage();
    await ready();
    await screen.findByRole('region', { name: '今日反馈' });
    fireEvent.keyDown(window, { key: 't' });
    const panel = await screen.findByRole('tab', { name: /待发/ });
    expect(panel).toHaveAttribute('aria-selected', 'true');
    const region = screen.getByRole('region', { name: '今日反馈' });
    expect(within(region).getByText('新生已填')).toBeInTheDocument();
    expect(within(region).getByText('Angela')).toBeInTheDocument();
    expect(within(region).getByText('每日 · 新生第 6 天')).toBeInTheDocument();
    expect(within(region).getByText('数学二次函数那节，你把例题抄了一遍。')).toBeInTheDocument();

    fireEvent.click(within(region).getByRole('button', { name: /^已发/ }));
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(1));
    const patch = updates('supervision_drafts')[0].args;
    expect(patch.status).toBe('sent');
    expect(patch.handled_by).toBe('admin-1');
    expect(typeof patch.handled_at).toBe('string');
    await waitFor(() => expect(within(region).getByText('没有待发的草稿')).toBeInTheDocument());
  });

  it('点正文原地修改，失焦保存到 edited_body', async () => {
    setup({ drafts: [draft()] });
    renderPage();
    await ready();
    await screen.findByRole('region', { name: '今日反馈' });
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(await screen.findByText('数学二次函数那节，你把例题抄了一遍。'));
    const box = await screen.findByDisplayValue('数学二次函数那节，你把例题抄了一遍。');
    fireEvent.change(box, { target: { value: '二次函数那节，例题抄了两遍。' } });
    fireEvent.blur(box);
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(1));
    expect(updates('supervision_drafts')[0].args).toEqual({ edited_body: '二次函数那节，例题抄了两遍。' });
    expect(await screen.findByText('二次函数那节，例题抄了两遍。')).toBeInTheDocument();
  });

  it('C 复制选中的草稿，E 标记已发（只在展开时）', async () => {
    setup({ drafts: [draft()] });
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await ready();
    await screen.findByRole('region', { name: '今日反馈' });
    fireEvent.keyDown(window, { key: 'c' });          // 折叠时不处理
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 't' });
    await screen.findByRole('tab', { name: /待发/ });
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('数学二次函数那节，你把例题抄了一遍。'));
    fireEvent.keyDown(window, { key: 'e' });
    await waitFor(() => expect(updates('supervision_drafts').length).toBe(1));
  });

  it('两份没填名单：姓名链接打开侧栏，复制名单写入纯文本', async () => {
    setup();
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderPage();
    await ready();
    await screen.findByRole('region', { name: '今日反馈' });
    fireEvent.keyDown(window, { key: 't' });
    // 没有草稿表 → 默认落在第一个有内容的页签：新生昨天没填
    const region = screen.getByRole('region', { name: '今日反馈' });
    await waitFor(() => expect(within(region).getByRole('tab', { name: /新生昨天没填/ })).toHaveAttribute('aria-selected', 'true'));
    expect(within(region).getByText('新生 · 第 11 天')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: '复制名单' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^新生昨天没填（1 人）\n新生未填（Angela） · 新生 · 第 11 天 · 最后记录 /);

    fireEvent.click(within(region).getByRole('tab', { name: /3 天以上没填/ }));
    expect(within(region).getByText('5 天没填')).toBeInTheDocument();
    fireEvent.click(within(region).getByText('久未填'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('久未填')).toBeInTheDocument();
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
    renderPage();
    await waitFor(() => expect(screen.getAllByText('久未填').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: '再次邀请' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/notify');
    expect(JSON.parse(opts.body)).toEqual({ type: 'reinvite', student_id: 's-gap' });
    expect(opts.headers.Authorization).toMatch(/^Bearer /);
    const calls = supabase.__getCallHistory().filter((c) => c.method === 'rpc' && c.table === 'mentor_reinvite');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_student).toBe('s-gap');
  });
});
