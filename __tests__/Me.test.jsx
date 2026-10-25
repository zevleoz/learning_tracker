import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { supabase } from '../src/__mocks__/supabase';
import Me, { Reminders, normalizePrefs } from '../src/pages/student/Me.jsx';
import { MENTOR_ACCESS } from '../src/pages/Notifications.jsx';
import * as push from '../src/lib/push.js';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

const mockSignOut = jest.fn(async () => {});
jest.mock('../src/lib/useAuth.js', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { id: 'u1', email: 'yz@school.edu' },
    profile: { id: 'u1', role: 1, full_name: '陈一舟' },
    loading: false,
    signOut: mockSignOut,
  }),
}));

jest.mock('../src/lib/push.js', () => ({
  __esModule: true,
  getPermission: jest.fn(() => 'default'),
  isIOSNeedsInstall: jest.fn(() => false),
  isPushSupported: jest.fn(() => true),
  subscribe: jest.fn(async () => ({ ok: true })),
  unsubscribe: jest.fn(async () => ({ ok: true })),
}));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

function renderAt(path, element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/me" element={element} />
        <Route path="/me/reminders" element={element} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function seed({ connections = [], extraProfiles = [] } = {}) {
  supabase.__resetMocks();
  supabase.__setAuthState({
    user: { id: 'u1', email: 'yz@school.edu', user_metadata: { full_name: '陈一舟' } },
    session: {},
  });
  // components/ 下的组件经 moduleNameMapper 拿到 __mocks__/useAuth，这里同步一份登录态
  setAuthUser({ id: 'u1', email: 'yz@school.edu' });
  setAuthProfile({ id: 'u1', role: 1, full_name: '陈一舟' });
  supabase.__setTableData('profiles', [
    { id: 'u1', role: 1, full_name: '陈一舟', school_name: '明德高中' },
    { id: 't1', role: 2, full_name: '李老师' },
    { id: 't2', role: 2, full_name: '王老师' },
    ...extraProfiles,
  ]);
  supabase.__setTableData('courses', [
    { id: 'c1', name: '数学', created_by: 'u1', deleted_at: null },
    { id: 'c2', name: '英语', created_by: 'u1', deleted_at: null },
    { id: 'c3', name: '同学的课', created_by: 'other', deleted_at: null },
  ]);
  supabase.__setTableData('teacher_student_connections', connections);
}

const updates = (table) => supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === table);

beforeEach(() => {
  jest.clearAllMocks();
  push.getPermission.mockReturnValue('default');
  push.isIOSNeedsInstall.mockReturnValue(false);
  push.isPushSupported.mockReturnValue(true);
  push.subscribe.mockResolvedValue({ ok: true });
});

describe('我的 · 资料与设置', () => {
  it('显示昵称、学校（纯文本）、邮箱和课程数，不再有无操作的「外观」行', async () => {
    seed();
    renderAt('/me', <Me />);
    expect(await screen.findByRole('heading', { name: '陈一舟' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/明德高中 · yz@school\.edu/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('2 门')).toBeInTheDocument()); // 只数自己的课程
    expect(screen.queryByText('跟随系统')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /我的课程/ })).toHaveAttribute('href', '/me/courses');
    expect(screen.getByRole('link', { name: /提醒/ })).toHaveAttribute('href', '/me/reminders');
  });

  it('编辑资料：预填学校，保存后写入 profiles', async () => {
    seed();
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = await screen.findByRole('dialog', { name: '个人资料' });
    const school = within(dialog).getByLabelText('学校', { exact: false });
    await waitFor(() => expect(school).toHaveValue('明德高中'));
    fireEvent.change(school, { target: { value: '新学校' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updates('profiles').some((c) => c.args.school_name === '新学校')).toBe(true));
  });

  it('退出登录：确认后调用 signOut 并回到登录页', async () => {
    seed();
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    const dialog = await screen.findByRole('dialog', { name: '退出登录？' });
    fireEvent.click(within(dialog).getByRole('button', { name: '退出' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login'));
  });
});

describe('我的 · 导师邀请同意页', () => {
  const PENDING = [{ id: 'k1', teacher_id: 't1', student_id: 'u1', status: 0, note: '想帮你看看进度', created_at: '2026-10-23T08:00:00Z', updated_at: '2026-10-23T08:00:00Z' }];

  it('待处理邀请：同意页逐条列出老师能看到什么、不能做什么', async () => {
    seed({ connections: PENDING });
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: /李老师邀请你连接/ }));
    const dialog = await screen.findByRole('dialog', { name: '李老师想查看你的学习数据' });
    for (const line of [...MENTOR_ACCESS.can, ...MENTOR_ACCESS.mayDo, ...MENTOR_ACCESS.cannot]) {
      expect(within(dialog).getByText(line)).toBeInTheDocument();
    }
    expect(within(dialog).getByText(/想帮你看看进度/)).toBeInTheDocument();
    // 点开不等于接受：没有任何写入
    expect(updates('teacher_student_connections')).toHaveLength(0);
  });

  it('同意页的承诺与数据库范围一致（RLS 对照）', () => {
    // learning_sessions / exam_scores 可读，且没有时间下限
    expect(MENTOR_ACCESS.can.join('|')).toMatch(/学习记录.*接受之前的全部记录/);
    expect(MENTOR_ACCESS.can.join('|')).toMatch(/主观评价和客观评价/);
    expect(MENTOR_ACCESS.can.join('|')).toMatch(/考试成绩/);
    // 导师无法写学生的记录（sessions_update/insert 仅 student_id = auth.uid()）
    expect(MENTOR_ACCESS.cannot.join('|')).toMatch(/不能修改或删除/);
    // update_student_name / update_student_school RPC 允许已连接导师改姓名与学校
    expect(MENTOR_ACCESS.mayDo.join('|')).toMatch(/姓名和学校/);
  });

  it('接受：把 status 更新为 1（只限本人的连接）', async () => {
    seed({ connections: PENDING });
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: /李老师邀请你连接/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '接受' }));
    await waitFor(() => {
      const u = updates('teacher_student_connections');
      expect(u).toHaveLength(1);
      expect(u[0].args.status).toBe(1);
    });
    // 邀请卡消失，导师出现在已连接列表
    await waitFor(() => expect(screen.queryByRole('button', { name: /李老师邀请你连接/ })).not.toBeInTheDocument());
    expect(await screen.findByText(/已连接/)).toBeInTheDocument();
  });

  it('拒绝：status 更新为 2', async () => {
    seed({ connections: PENDING });
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: /李老师邀请你连接/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(updates('teacher_student_connections')[0].args.status).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /李老师邀请你连接/ })).not.toBeInTheDocument());
  });

  it('已连接导师：断开前需二次确认', async () => {
    seed({ connections: [{ id: 'k2', teacher_id: 't2', student_id: 'u1', status: 1, created_at: '2026-09-02T08:00:00Z', updated_at: '2026-09-02T08:00:00Z' }] });
    renderAt('/me', <Me />);
    fireEvent.click(await screen.findByRole('button', { name: /王老师/ }));
    const dialog = await screen.findByRole('dialog', { name: '王老师' });
    fireEvent.click(within(dialog).getByRole('button', { name: '断开连接' }));
    expect(updates('teacher_student_connections')).toHaveLength(0);
    expect(within(dialog).getByText(/将立即无法再查看/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认断开' }));
    await waitFor(() => expect(updates('teacher_student_connections')[0].args.status).toBe(2));
  });
});

describe('提醒设置', () => {
  it('normalizePrefs 补全缺省并丢弃脏数据', () => {
    expect(normalizePrefs(null).invites).toBe(true);
    const p = normalizePrefs({ daily_reminder: 'yes', daily_reminder_time: '25:99', weekly_email: true });
    expect(p.daily_reminder).toBe(false);
    expect(p.daily_reminder_time).toBe('21:00');
    expect(p.weekly_email).toBe(true);
  });

  it('打开页面不请求权限；iOS 未安装时显示添加到主屏幕卡片', async () => {
    seed();
    push.isIOSNeedsInstall.mockReturnValue(true);
    push.isPushSupported.mockReturnValue(false);
    renderAt('/me/reminders', <Reminders />);
    expect(await screen.findByText('iPhone 需要先添加到主屏幕')).toBeInTheDocument();
    expect(screen.getByText('添加到主屏幕')).toBeInTheDocument();
    expect(push.subscribe).not.toHaveBeenCalled();
    // 此时推送类开关不可用
    expect(screen.getByRole('switch', { name: '每日提醒' })).toBeDisabled();
  });

  it('非 iOS 不显示安装卡片', async () => {
    seed();
    renderAt('/me/reminders', <Reminders />);
    await screen.findByRole('switch', { name: '每日提醒' });
    expect(screen.queryByText('iPhone 需要先添加到主屏幕')).not.toBeInTheDocument();
    expect(push.subscribe).not.toHaveBeenCalled();
  });

  it('第一次打开开关时才请求授权并订阅，然后保存 notification_prefs', async () => {
    seed();
    push.subscribe.mockImplementation(async () => {
      push.getPermission.mockReturnValue('granted');
      return { ok: true };
    });
    renderAt('/me/reminders', <Reminders />);
    const sw = await screen.findByRole('switch', { name: '每日提醒' });
    await waitFor(() => expect(sw).not.toBeDisabled());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(push.subscribe).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.getByRole('switch', { name: '每日提醒' })).toHaveAttribute('aria-checked', 'true'));
    const saved = updates('profiles').pop();
    expect(saved.args.notification_prefs.daily_reminder).toBe(true);
    expect(saved.args.notification_prefs.invites).toBe(true);
    // 开启后出现提醒时间
    expect(screen.getByLabelText('每日提醒时间')).toHaveValue('21:00');
  });

  it('授权被拒绝：开关保持关闭，不写库，并给出说明', async () => {
    seed();
    push.subscribe.mockResolvedValue({ ok: false, reason: 'denied' });
    renderAt('/me/reminders', <Reminders />);
    const sw = await screen.findByRole('switch', { name: '待补填' });
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    expect(await screen.findByRole('alert')).toHaveTextContent('权限被拒绝');
    expect(screen.getByRole('switch', { name: '待补填' })).toHaveAttribute('aria-checked', 'false');
    expect(updates('profiles')).toHaveLength(0);
  });

  it('notification_prefs 列还不存在时降级：提示准备中，开关禁用', async () => {
    seed();
    const orig = supabase.from.bind(supabase);
    jest.spyOn(supabase, 'from').mockImplementation((t) => {
      if (t !== 'profiles') return orig(t);
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: null, error: { code: '42703', message: 'column profiles.notification_prefs does not exist' } }),
      };
      return b;
    });
    renderAt('/me/reminders', <Reminders />);
    expect(await screen.findByText(/还在准备中/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '每日提醒' })).toBeDisabled();
    supabase.from.mockRestore();
  });

  it('已授权时，推送类开关按已存偏好显示；关掉最后一个会取消订阅', async () => {
    seed();
    supabase.__setTableData('profiles', [
      { id: 'u1', role: 1, notification_prefs: { daily_reminder: false, pending_digest: true, streak_reminder: false, invites: false, weekly_email: false, daily_reminder_time: '21:00' } },
    ]);
    push.getPermission.mockReturnValue('granted');
    renderAt('/me/reminders', <Reminders />);
    const digest = await screen.findByRole('switch', { name: '待补填' });
    await waitFor(() => expect(digest).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('switch', { name: '导师邀请' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(digest);
    await waitFor(() => expect(push.unsubscribe).toHaveBeenCalled());
  });
});
