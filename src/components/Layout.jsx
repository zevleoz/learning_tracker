import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.js';
import logoSmall from '../logo/logo_red.png';
import logoInline from '../logo/logo_red.png';

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

export default function Layout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isTeacher = Number(profile?.role) >= 2;

  // 实际导航项：
  //   老师端：导师 + 课程 + 记录 + 回顾 + 通知
  //   学生端：课程 + 记录 + 回顾 + 通知
  const finalNavItems = useMemo(
    () =>
      isTeacher
        ? [
            { to: '/mentor', label: '导师', Icon: IconTeacher },
            ...NAV_ITEMS,
            { to: '/notifications', label: '通知', Icon: IconBell },
          ]
        : [...NAV_ITEMS, { to: '/notifications', label: '通知', Icon: IconBell }],
    [isTeacher]
  );

  useEffect(() => {
    function update() {
      setIsMobile(window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches);
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 8); }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function handleSignOut() {
    await signOut();
    nav('/login', { replace: true });
  }

  /* ---- 左边缘滑动返回（iOS 原生感） ---- */
  useEffect(() => {
    const EDGE = 30; // 左边缘 30px 内开始
    const MIN_DIST = 50; // 至少右滑 50px 触发返回
    let startX = 0, startY = 0, tracking = false, triggered = false;

    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX > EDGE) return;
      startX = t.clientX; startY = t.clientY;
      tracking = true; triggered = false;
    }
    function onTouchMove(e) {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // 必须是横向主导滑动（避免与垂直滚动冲突）
      if (Math.abs(dx) > Math.abs(dy) && dx > 8) {
        e.preventDefault();
      }
    }
    function onTouchEnd(e) {
      if (!tracking) return;
      const t = (e.changedTouches && e.changedTouches[0]) || null;
      if (!t) { tracking = false; return; }
      const dx = t.clientX - startX;
      if (!triggered && dx >= MIN_DIST) {
        triggered = true;
        // 导航返回
        nav(-1);
      }
      tracking = false;
    }

    // passive:false 才能 preventDefault
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [nav]);

  /* ---- 底部导航 pill 横向滑动切换 tab（配合 iOS 滑动选择） ---- */
  const pillRef = useRef(null);
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    let startX = 0, startY = 0, tracking = false, moved = false;

    function onStart(e) {
      const t = (e.touches && e.touches[0]) || e;
      startX = t.clientX; startY = t.clientY;
      tracking = true; moved = false;
    }
    function onMove(e) {
      if (!tracking) return;
      const t = (e.touches && e.touches[0]) || e;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        e.preventDefault();
        moved = true;
      }
    }
    function onEnd(e) {
      if (!tracking) return;
      const t = (e.changedTouches && e.changedTouches[0]) || (e.changedTouches ? null : e);
      tracking = false;
      if (!moved || !t) return;
      const dx = t.clientX - startX;
      if (Math.abs(dx) < 40) return;

      // 在当前 nav items 中找到当前激活项的 index，左右移动
      const currentPath = location.pathname;
      const idx = finalNavItems.findIndex((x) => currentPath === x.to || currentPath.startsWith(x.to + '/'));
      if (idx < 0) return;
      const nextIdx = dx < 0 ? Math.min(idx + 1, finalNavItems.length - 1) : Math.max(idx - 1, 0);
      if (nextIdx !== idx) nav(finalNavItems[nextIdx].to);
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [finalNavItems, location.pathname, nav]);

  /* ========= 移动端：顶部极简 + 底部浮动 pill ========= */
  if (isMobile) {
    return (
      <div className="page-container">
        <header className="m-topbar">
          <img src={logoSmall} className="topbar-logo" alt="logo" />
          {profile?.full_name && (
            <button className="signout-btn" onClick={handleSignOut}>
              {profile.full_name}
            </button>
          )}
        </header>

        {/* key = location.pathname 让 React 在路由切换时卸载旧 DOM、
            装载新 DOM，从而触发 CSS animation 的 from → to */}
        <main key={location.pathname} className="main page-enter">
          <Outlet />
        </main>

        <nav className="m-nav-pill" aria-label="主导航" ref={pillRef}>
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
    <div className="page-container">
      <header className={'d-topbar' + (scrolled ? ' is-scrolled' : '')}>
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
            {isTeacher && (
              <span style={{
                fontSize: '11px', padding: '3px 8px', borderRadius: '999px',
                background: 'rgba(99,102,241,0.12)', color: '#4338ca',
                border: '1px solid rgba(99,102,241,0.25)', marginLeft: '4px',
              }}>老师</span>
            )}
            <button className="signout-btn" onClick={handleSignOut}>退出</button>
          </div>
        </div>
      </header>

      <main key={location.pathname} className="main page-enter">
        <Outlet />
      </main>
    </div>
  );
}
