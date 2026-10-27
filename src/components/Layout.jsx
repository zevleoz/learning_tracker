import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.js';
import { syncSubscription } from '../lib/push.js';
import ToastHost from './ToastHost.jsx';
import { supabase } from '../lib/supabase.js';
import { prefetchStudentPages } from '../pages/student/loaders.js';
import { useCached } from '../lib/useCached.js';
import { patch, invalidate } from '../lib/studentCache.js';
import { KEYS, fetchInviteCount } from '../lib/studentResources.js';
import logoSmall from '../logo/crest_red_small.png';
import logoInline from '../logo/crest_red_small.png';

/* ------- 单色线图标 (20x20, stroke=currentColor) ------- */
function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6 10.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8.5" />
    </svg>
  );
}
function IconPencil() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
    </svg>
  );
}
function IconTeacher() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="12" cy="8" r="3" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// 导航项（手机底栏 / 图标轨 / 桌面侧栏同一份）。key 是键盘快捷键 1–4。
// 注意：/today 与 /insights 路由在 WS6 合并后才接入 App.jsx（见 App.jsx 的 TODO(WS6)）。
export const NAV_ITEMS = [
  { to: '/today',    label: '今天', Icon: IconHome,   key: '1' },
  { to: '/records',  label: '记录', Icon: IconPencil, key: '2', alsoActive: ['/learning'] },
  { to: '/insights', label: '洞察', Icon: IconChart,  key: '3' },
  { to: '/me',       label: '我的', Icon: IconUser,   key: '4', badge: true, prefix: true },
];

// 键盘在输入控件里时，快捷键一律让位
export function isTypingTarget(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

// 导师台 /mentor 自带整页布局：不套学生外壳，也不响应学生端快捷键
function isMentorSurface(pathname) {
  return pathname === '/mentor' || pathname.startsWith('/mentor/');
}

function isOnRecords(pathname) {
  return pathname === '/records' || pathname === '/learning';
}

function isItemActive(item, pathname) {
  if (pathname === item.to) return true;
  if (item.prefix && pathname.startsWith(item.to + '/')) return true;
  return Boolean(item.alsoActive?.includes(pathname));
}

// 往下滚超过这个距离后，tab bar 才开始收起（避免顶部回弹时抖动）
const SHRINK_AFTER = 48;
// 单次滚动位移小于该阈值不改变状态（过滤触摸板细微抖动）
const SCROLL_DELTA = 6;

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  const userId = user?.id || profile?.id;
  const nav = useNavigate();
  const location = useLocation();
  const [shrunk, setShrunk] = useState(false);
  // 待处理导师邀请数：与「今天」「我的」共用一份缓存，不再各查各的
  const notificationCount = useCached(userId, KEYS.invites, () => fetchInviteCount(userId)).data ?? 0;

  const isTeacher = Number(profile?.role) >= 2;

  // 打开应用时，把这台设备已授权的推送订阅重新写到服务器（幂等）。
  // 修复「浏览器里有订阅、服务器却没记录」：之前保存失败，或同一台设备换了账号登录。
  useEffect(() => {
    if (!profile?.id || isTeacher || typeof syncSubscription !== 'function') return;
    syncSubscription().catch(() => {});
  }, [profile?.id, isTeacher]);

  // 学生端：首屏之后空闲时预取其余页面的代码，切页时不再等一次下载
  useEffect(() => {
    if (profile?.id && !isTeacher) prefetchStudentPages();
  }, [profile?.id, isTeacher]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'teacher_student_connections',
          filter: `student_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new.status === 0) {
            patch(userId, KEYS.invites, (c) => (c || 0) + 1);
          } else if (payload.eventType === 'UPDATE' || payload.eventType === 'DELETE') {
            invalidate(userId, KEYS.invites);   // 已挂载的订阅者（本组件）会立刻后台重取
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // 实际导航项：学生 今天 · 记录 · 洞察 · 我的；老师端在最前多一个「导师」
  const finalNavItems = useMemo(
    () => (isTeacher ? [{ to: '/mentor', label: '导师', Icon: IconTeacher }, ...NAV_ITEMS] : NAV_ITEMS),
    [isTeacher]
  );

  /* ---- 向下滚动收起 tab bar、向上滚动展开（仅手机底栏样式下有视觉效果） ---- */
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY;
      const dy = y - lastY;
      if (y <= SHRINK_AFTER) {
        setShrunk(false);
        lastY = y;
      } else if (Math.abs(dy) >= SCROLL_DELTA) {
        setShrunk(dy > 0);
        lastY = y;
      }
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 换页后回到展开态
  useEffect(() => { setShrunk(false); }, [location.pathname]);

  async function handleSignOut() {
    await signOut();
    nav('/login', { replace: true });
  }

  // ＋：在记录页直接通知 LogSheet 打开，其它页先跳转再由 ?log=1 打开
  const pathname = location.pathname;
  const onMentorSurface = isMentorSurface(pathname);
  const openLog = useCallback(() => {
    if (isOnRecords(pathname)) {
      window.dispatchEvent(new CustomEvent('yb:open-log'));
    } else {
      nav('/records?log=1');
    }
  }, [pathname, nav]);

  // 桌面快捷键：N 记一笔 · 1–4 切页 · Esc 关闭面板。输入框内、带修饰键、已有弹层时不响应
  useEffect(() => {
    function onKeyDown(e) {
      if (onMentorSurface || e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('yb:close-log'));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openLog();
        return;
      }
      const item = NAV_ITEMS.find((it) => it.key === e.key);
      if (item) {
        e.preventDefault();
        nav(item.to);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openLog, nav, onMentorSurface]);

  // 导师台 (/mentor) 自带整页布局，不套学生外壳。
  if (onMentorSurface) {
    return <Outlet />;
  }

  const initial = (profile?.full_name || '').trim().slice(0, 1) || '我';

  return (
    <div className="page-container yb-student yb-shell">
      {/* 手机顶栏：只在 <600px 显示；点姓名打开资料（含退出登录） */}
      <header className="yb-topbar">
        <img src={logoSmall} className="yb-topbar-logo" alt="一表人才" />
        {profile?.full_name && (
          <button
            type="button"
            className="yb-topbar-user"
            onClick={() => nav('/me')}
            aria-label="打开我的"
          >
            {profile.full_name}
          </button>
        )}
      </header>

      {/* key = location.pathname：路由切换时重挂载，触发 120ms 淡入 */}
      <main key={location.pathname} className="main yb-main page-enter">
        <Outlet />
      </main>

      <ToastHost />

      {/* 同一份 DOM，三种形态（见 index.css）：
          ≥920px 浮动侧栏 · 600–919px 图标轨 · <600px 底部玻璃 tab bar */}
      <nav className={'yb-nav' + (shrunk ? ' is-shrunk' : '')} aria-label="主导航">
        <div className="yb-brand">
          <img src={logoInline} alt="" />
          <b>一表人才</b>
        </div>

        <button type="button" className="yb-add" onClick={openLog} aria-label="记一下">
          <IconPlus />
          <span className="yb-add-label">记一下</span>
          <kbd className="yb-kbd" aria-hidden="true">N</kbd>
        </button>

        <div className="yb-tabs">
          {finalNavItems.map((item) => {
            const { to, label, Icon } = item;
            const active = isItemActive(item, pathname);
            const count = item.badge ? notificationCount : 0;
            return (
              <Link
                key={to}
                to={to}
                className={'yb-tab' + (active ? ' on' : '')}
                aria-current={active ? 'page' : undefined}
                aria-label={count > 0 ? `${label}，${count} 条待处理邀请` : undefined}
              >
                <span className="yb-tab-icon">
                  <Icon />
                  {count > 0 && (
                    <span className="yb-badge">{count > 99 ? '99+' : count}</span>
                  )}
                </span>
                <span className="yb-tab-label">{label}</span>
                {item.key && <kbd className="yb-kbd" aria-hidden="true">{item.key}</kbd>}
              </Link>
            );
          })}
        </div>

        <div className="yb-me">
          <button
            type="button"
            className="yb-me-btn"
            onClick={() => nav('/me')}
            aria-label="打开我的"
          >
            <span className="yb-avatar" aria-hidden="true">{initial}</span>
            <span className="yb-me-name">{profile?.full_name || '我的资料'}</span>
          </button>
          <button type="button" className="yb-signout" onClick={handleSignOut}>退出</button>
        </div>
      </nav>

    </div>
  );
}
