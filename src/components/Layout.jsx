import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import logoSmall from '../logo/logo_red.png';
import logoInline from '../logo/logo_inline.png';

/* ------- 单色线图标 (20x20, stroke=currentColor) ------- */
function IconCourse() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5.5z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
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
function IconTeacher() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="12" cy="8" r="3" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

// 导航项
const NAV_ITEMS = [
  { to: '/syllabus', label: '课程', Icon: IconCourse },
  { to: '/learning', label: '记录', Icon: IconPencil },
  { to: '/review',   label: '回顾', Icon: IconChart },
];

const MOBILE_BREAKPOINT = 767;

/** iOS 风格左边缘滑动返回手势：当用户在屏幕左边缘 <24px 按下并向右滑动 >60px 时返回上一页 */
function useSwipeBack(enabled) {
  const nav = useNavigate();
  const startRef = useRef(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    function onTouchStart(e) {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX < 24) {
        startRef.current = { x: t.clientX, y: t.clientY };
        activeRef.current = true;
      }
    }
    function onTouchEnd(e) {
      if (!activeRef.current) return;
      activeRef.current = false;
      const t = e.changedTouches[0];
      if (!t || !startRef.current) return;
      const dx = t.clientX - startRef.current.x;
      const dy = Math.abs(t.clientY - startRef.current.y);
      // 水平滑动为主，且向右超过 60px
      if (dx > 60 && dx > dy * 1.2) {
        nav(-1);
      }
      startRef.current = null;
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [enabled, nav]);
}

export default function Layout() {
  const nav = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);

  // 用户侧/导师侧信息由父级 useAuth 提供，这里用 dummy 以保持最小改动
  const profile = { full_name: '学习者', role: 1 };

  const isTeacher = Number(profile?.role) >= 2;

  const finalNavItems = isTeacher
    ? [
        { to: '/mentor', label: '导师', Icon: IconTeacher },
        ...NAV_ITEMS,
        { to: '/notifications', label: '通知', Icon: IconBell },
      ]
    : [...NAV_ITEMS, { to: '/notifications', label: '通知', Icon: IconBell }];

  useEffect(() => {
    function update() {
      setIsMobile(window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches);
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useSwipeBack(isMobile);

  async function handleSignOut() {
    // 简单的占位登出；实际由 useAuth 处理
    if (window.confirm) {
      nav('/login', { replace: true });
    }
  }

  /* ========= 移动端：顶部极简 + 底部浮动 pill ========= */
  if (isMobile) {
    return (
      <div style={{ minHeight: '100dvh' }}>
        <header className="m-topbar">
          <img src={logoSmall} className="topbar-logo" alt="logo" />
          {profile?.full_name && (
            <button className="signout-btn" onClick={handleSignOut}>
              {profile.full_name}
            </button>
          )}
        </header>

        {/* 使用 location.pathname 作为 key，触发每次路由变化时重启动画 */}
        <main className="main" key={location.pathname}>
          <div className="animate-ios">
            <Outlet />
          </div>
        </main>

        <nav className="m-nav-pill" aria-label="主导航">
          <div className="m-nav-pill-inner">
            {finalNavItems.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) => 'm-nav-link' + (isActive ? ' active' : '')}
              >
                <span className="m-nav-icon"><Icon /></span>
                <span className="m-nav-label">{label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    );
  }

  /* ========= 桌面端：顶部吸附条 + 横向胶囊导航 ========= */
  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="d-topbar">
        <div className="d-topbar-inner">
          <img src={logoInline} className="brand-inline" alt="logo" />

          <nav className="d-nav-group">
            {finalNavItems.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) => 'd-nav-link' + (isActive ? ' active' : '')}
              >
                <span className="d-nav-icon"><Icon /></span>
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="d-right">
            {profile?.full_name && <span className="d-user">{profile.full_name}</span>}
            <button className="signout-btn" onClick={handleSignOut}>退出</button>
          </div>
        </div>
      </header>

      <main className="main" key={location.pathname}>
        <div className="animate-ios">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
