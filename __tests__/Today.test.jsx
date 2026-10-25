import { render, screen, waitFor, fireEvent, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Today from '../src/pages/student/Today';
import { useStudentData, openLogSheet } from '../src/lib/useStudentData.js';
import { supabase } from '../src/__mocks__/supabase';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';

jest.mock('../src/lib/push.js', () => ({
  __esModule: true,
  getPermission: jest.fn(() => 'unsupported'),
  isIOSNeedsInstall: jest.fn(() => false),
  isPushSupported: jest.fn(() => false),
  subscribe: jest.fn(async () => ({ ok: true })),
  unsubscribe: jest.fn(async () => ({ ok: true })),
  setAppBadge: jest.fn(async () => {}),
  syncSubscription: jest.fn(async () => ({ ok: true })),
}));
const push = require('../src/lib/push.js');

// 2026-10-24 周六 15:00（本周 10/19–10/25）
const TODAY = new Date(2026, 9, 24, 15, 0);
const PHYS = { id: 'c-phys', name: 'AP 物理 C', course_type: 2 };
const CALC = { id: 'c-calc', name: 'AP 微积分 BC', course_type: 1 };

let n = 0;
function row(o) {
  n += 1;
  const course = o.course_id === 'c-calc' ? CALC : PHYS;
  return {
    id: `s-${n}`, student_id: 'u1', session_date: '2026-10-24', start_time: '19:00:00',
    duration_minutes: 30, category: 1, form: '自主学习', self_rating: 80, grade_label: null,
    score: null, deleted_at: null, chapter_id: null, unit_id: null, course, course_id: 'c-phys', ...o,
  };
}

function seed() {
  n = 0;
  supabase.__resetMocks();
  setAuthUser({ id: 'u1' });
  setAuthProfile({ id: 'u1', full_name: '一舟' });
  supabase.__setTableData('learning_sessions', [
    row({ start_time: '07:30:00', duration_minutes: 40, category: 2, form: '自主复习' }),
    row({ course_id: 'c-calc', duration_minutes: 45, category: 3, form: '自主练习' }),   // 待补填
    row({ session_date: '2026-10-23', duration_minutes: 10 }),
    row({ session_date: '2026-10-22', duration_minutes: 60 }),
    row({ session_date: '2026-10-21', duration_minutes: 20 }),
    row({ session_date: '2026-10-20', course_id: 'c-calc', duration_minutes: 30 }),
    row({ session_date: '2026-10-18', duration_minutes: 30 }),                           // 上周
    row({ session_date: '2026-10-14', duration_minutes: 50, category: 2 }),             // 上周
    row({ session_date: '2026-10-24', duration_minutes: 999, deleted_at: '2026-10-24T01:00:00Z' }),
    row({ session_date: '2024-02-01', duration_minutes: 20 }),                          // 窗口之外
  ]);
  supabase.__setTableData('courses', [{ ...CALC, created_by: 'u1', deleted_at: null, subject: '' }]);
  supabase.__setTableData('exam_scores', []);
  supabase.__setTableData('teacher_student_connections', [
    { id: 't1', student_id: 'u1', status: 0 },
    { id: 't2', student_id: 'u1', status: 1 },
  ]);
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.search}</div>;
}
function renderToday(path = '/today') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/today" element={<Today today={TODAY} />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  seed();
  jest.clearAllMocks();
  window.localStorage.clear();
  push.getPermission.mockReturnValue('unsupported');
  push.isPushSupported.mockReturnValue(false);
  push.isIOSNeedsInstall.mockReturnValue(false);
  push.subscribe.mockResolvedValue({ ok: true });
});

describe('useStudentData', () => {
  it('取回近 2 年未删除记录（倒序）、邀请数、校内课程', async () => {
    const { result } = renderHook(() => useStudentData({ today: TODAY }));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const { sessions, pendingInvites, examCourses } = result.current;
    expect(sessions).toHaveLength(8);                       // 软删除与 2024 年的行都不在
    expect(sessions.every((s) => !s.deleted_at)).toBe(true);
    expect(sessions[0].session_date >= sessions[sessions.length - 1].session_date).toBe(true);
    expect(pendingInvites).toBe(1);                         // 只数 status = 0
    expect(examCourses.map((c) => c.id)).toEqual(['c-calc']);
    expect(result.current.error).toBeNull();
  });

  it('跨多个时间窗口：一年多以前的记录也在（连续天数用）', async () => {
    supabase.__setTableData('learning_sessions', [
      row({ session_date: '2025-04-01' }), row({ session_date: '2026-10-24' }),
    ]);
    const { result } = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((s) => s.session_date)).toEqual(['2026-10-24', '2025-04-01']);
  });

  it('主查询失败时给出 error，附加数据失败不影响页面', async () => {
    const real = supabase.from.bind(supabase);
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
      if (t !== 'learning_sessions') return real(t);
      const q = {};
      ['select', 'eq', 'is', 'gte', 'lt', 'order'].forEach((m) => { q[m] = () => q; });
      q.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return q;
    });
    const { result } = renderHook(() => useStudentData({ today: TODAY }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    spy.mockRestore();
  });
});

describe('openLogSheet', () => {
  it('在记录页直接派发事件', () => {
    const navigate = jest.fn();
    const got = jest.fn();
    window.addEventListener('yb:open-log', got);
    openLogSheet(navigate, { category: 2 }, '/records');
    window.removeEventListener('yb:open-log', got);
    expect(navigate).not.toHaveBeenCalled();
    expect(got.mock.calls[0][0].detail).toEqual({ category: 2 });
  });
  it('在其它页面先跳到 /records?log=1 再补发预设', async () => {
    const navigate = jest.fn();
    const got = jest.fn();
    window.addEventListener('yb:open-log', got);
    openLogSheet(navigate, { courseId: 'c-1' }, '/today');
    expect(navigate).toHaveBeenCalledWith('/records?log=1');
    await waitFor(() => expect(got).toHaveBeenCalled());
    window.removeEventListener('yb:open-log', got);
    expect(got.mock.calls[0][0].detail).toEqual({ courseId: 'c-1' });
  });
});

describe('今天', () => {
  it('加载中先显示占位', async () => {
    renderToday();
    expect(screen.getByLabelText('正在加载')).toBeInTheDocument();
    await screen.findByText('下午好，一舟');
  });

  it('问候、日期、本周环、对比、连续天数', async () => {
    renderToday();
    expect(await screen.findByText('下午好，一舟')).toBeInTheDocument();
    expect(screen.getByText('10月24日 周六')).toBeInTheDocument();
    // 本周：40 + 45 + 10 + 60 + 20 + 30 = 205 分 → 3:25；其中学习 120、复习 40、练习 45
    expect(screen.getByRole('img', { name: '本周共 3:25' })).toBeInTheDocument();
    for (const t of ['2:00', '0:40', '0:45']) expect(screen.getByText(t)).toBeInTheDocument();
    // 上周同期（至 10/17）= 50 分
    expect(screen.getByText('比上周同期多 155 分')).toBeInTheDocument();
    expect(screen.queryByText(/还可休息/)).toBeNull();   // 不再有休息日额度文案
    expect(screen.getByText('5')).toBeInTheDocument();   // 20–24 日；19 日没有记录
    // 没有任何目标 / 还差
    expect(screen.queryByText(/目标|还差/)).toBeNull();
  });

  it('待办：待补填链接到 /records 的待补填 tab，导师邀请链接到 /me', async () => {
    renderToday();
    const pend = await screen.findByRole('link', { name: /1 条练习待补填客观评价/ });
    expect(pend).toHaveAttribute('href', '/records?tab=pending');
    expect(pend).toHaveTextContent('AP 微积分 BC');
    const invite = screen.getByRole('link', { name: /导师想查看/ });
    expect(invite).toHaveAttribute('href', '/me');
    fireEvent.click(pend);
    expect(await screen.findByTestId('loc')).toHaveTextContent('/records?tab=pending');
  });

  it('今天的时间线只含今天、未删除的记录，按开始时间排序', async () => {
    renderToday();
    await screen.findByText('下午好，一舟');
    const tl = screen.getByRole('region', { name: '今天' });
    const times = Array.from(tl.querySelectorAll('.sh-rec time')).map((t) => t.textContent);
    expect(times).toEqual(['07:30', '19:00']);
    expect(tl).toHaveTextContent('复习 · 自主复习');
    expect(tl).toHaveTextContent('85′');
    expect(tl).not.toHaveTextContent('999');
  });

  it('再记一次：点 chip 跳到 /records?log=1 并带上预设', async () => {
    const got = jest.fn();
    window.addEventListener('yb:open-log', got);
    renderToday();
    const chip = await screen.findByRole('button', { name: /AP 微积分 BC · 练习/ });
    fireEvent.click(chip);
    expect(await screen.findByTestId('loc')).toHaveTextContent('/records?log=1');
    await waitFor(() => expect(got).toHaveBeenCalled());
    window.removeEventListener('yb:open-log', got);
    expect(got.mock.calls[0][0].detail).toMatchObject({
      courseId: 'c-calc', category: 3, form: '自主练习', durationMinutes: 45,
    });
  });

  it('没有记录：给出平实的空状态，没有待办', async () => {
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('teacher_student_connections', []);
    renderToday();
    expect(await screen.findByText(/今天还没有记录/)).toBeInTheDocument();
    expect(screen.getByText(/没有待办/)).toBeInTheDocument();
    expect(screen.getByText(/今天记一次，开始计连续天数/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '本周共 0:00' })).toBeInTheDocument();
  });

  it('加载后把待补填数量设为图标角标', async () => {
    renderToday();
    await screen.findByText('下午好，一舟');
    expect(push.setAppBadge).toHaveBeenCalledWith(1);
  });

  describe('开启提醒小卡片', () => {
    const CARD_TEXT = '需要时提醒你？只在三天没记录时提醒一次。';
    const supported = () => {
      push.getPermission.mockReturnValue('default');
      push.isPushSupported.mockReturnValue(true);
    };
    const profilesRow = (prefs) => supabase.__setTableData('profiles', [{ id: 'u1', notification_prefs: prefs }]);
    const updates = () => supabase.__getCallHistory().filter((c) => c.method === 'update' && c.table === 'profiles');

    it('第 3 条记录之后、权限为 default 时出现；点「开启」才请求授权，授权后收起', async () => {
      supported();
      profilesRow({});
      renderToday();
      expect(await screen.findByText(CARD_TEXT)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: '开启提醒' })).toBeInTheDocument();
      expect(push.subscribe).not.toHaveBeenCalled();
      push.subscribe.mockImplementation(async () => { push.getPermission.mockReturnValue('granted'); return { ok: true }; });
      fireEvent.click(screen.getByRole('button', { name: '开启' }));
      await waitFor(() => expect(push.subscribe).toHaveBeenCalledWith('u1'));
      await waitFor(() => expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument());
    });

    it('记录不足 3 条不出现', async () => {
      supported();
      supabase.__setTableData('learning_sessions', [row({}), row({ session_date: '2026-10-23' })]);
      renderToday();
      await screen.findByText('下午好，一舟');
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
    });

    it.each(['granted', 'denied'])('权限已是 %s 时不出现', async (perm) => {
      supported();
      push.getPermission.mockReturnValue(perm);
      renderToday();
      await screen.findByText('下午好，一舟');
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
    });

    it('浏览器不支持推送时不出现', async () => {
      renderToday();
      await screen.findByText('下午好，一舟');
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
    });

    it('点「不用」：立刻收起，写入 notification_prefs，并且不会请求授权；之后不再出现', async () => {
      supported();
      profilesRow({ inactive_reminder: true });
      const { unmount } = renderToday();
      fireEvent.click(await screen.findByRole('button', { name: '不用' }));
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
      await waitFor(() => expect(updates()).toHaveLength(1));
      expect(updates()[0].args.notification_prefs).toMatchObject({ push_card_dismissed: true, inactive_reminder: true });
      expect(push.subscribe).not.toHaveBeenCalled();
      unmount();
      profilesRow({ push_card_dismissed: true });
      renderToday();
      await screen.findByText('下午好，一舟');
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
    });

    it('notification_prefs 列不存在时，「不用」退到 localStorage', async () => {
      supported();
      const real = supabase.from.bind(supabase);
      const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
        if (t !== 'profiles') return real(t);
        const b = {
          select: () => b,
          eq: () => b,
          update: () => b,
          maybeSingle: async () => ({ data: { notification_prefs: {} }, error: null }),
          then: (resolve) => resolve({ data: null, error: { code: '42703', message: 'column profiles.notification_prefs does not exist' } }),
        };
        return b;
      });
      const { unmount } = renderToday();
      fireEvent.click(await screen.findByRole('button', { name: '不用' }));
      await waitFor(() => expect(window.localStorage.getItem('yb:push-card-dismissed')).toBe('1'));
      unmount();
      renderToday();
      await screen.findByText('下午好，一舟');
      expect(screen.queryByText(CARD_TEXT)).not.toBeInTheDocument();
      spy.mockRestore();
    });

    it('iOS 没添加到主屏幕：不弹授权，卡片改为链接到 我的 › 提醒 看添加步骤', async () => {
      push.isIOSNeedsInstall.mockReturnValue(true);
      renderToday();
      const link = await screen.findByRole('link', { name: '查看步骤' });
      expect(link).toHaveAttribute('href', '/me/reminders');
      expect(screen.queryByRole('button', { name: '开启' })).not.toBeInTheDocument();
      expect(push.subscribe).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '不用' })).toBeInTheDocument();
    });
  });

  it('加载失败：显示错误并可重试', async () => {
    const real = supabase.from.bind(supabase);
    let fail = true;
    const spy = jest.spyOn(supabase, 'from').mockImplementation((t) => {
      if (t !== 'learning_sessions' || !fail) return real(t);
      const q = {};
      ['select', 'eq', 'is', 'gte', 'lt', 'order'].forEach((m) => { q[m] = () => q; });
      q.limit = () => Promise.resolve({ data: null, error: { message: 'boom' } });
      return q;
    });
    renderToday();
    expect(await screen.findByRole('alert')).toHaveTextContent('没能加载你的记录');
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
    expect(await screen.findByText('下午好，一舟')).toBeInTheDocument();
    spy.mockRestore();
  });
});
