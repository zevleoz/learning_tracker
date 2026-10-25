import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.js';
import { supabase } from '../lib/supabase.js';
import ProfileEditor from './ProfileEditor.jsx';
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
function IconPlus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// 导航项
const NAV_ITEMS = [
  { to: '/syllabus', label: '课程', Icon: IconCourse },
  { to: '/learning', label: '记录', Icon: IconPencil },
  { to: '/review',   label: '回顾', Icon: IconChart },
];

// 往下滚超过这个距离后，tab bar 才开始收起（避免顶部回弹时抖动）
const SHRINK_AFTER = 48;
// 单次滚动位移小于该阈值不改变状态（过滤触摸板细微抖动）
const SCROLL_DELTA = 6;

export default function Layout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [shrunk, setShrunk] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);

  const isTeacher = Number(profile?.role) >= 2;

  useEffect(() => {
    async function loadCount() {
      if (!profile?.id) return;
      try {
        const { data, error } = await supabase
          .from('teacher_student_connections')
          .select('id')
          .eq('student_id', profile.id)
          .eq('status', 0);
        if (!error) setNotificationCount(data?.length || 0);
      } catch {
        // 网络异常时静默处理，不影响主界面
      }
    }
    loadCount();

    const channel = supabase
      .channel(`notifications:${profile?.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'teacher_student_connections',
          filter: `student_id=eq.${profile?.id}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new.status === 0) {
            setNotificationCount((c) => c + 1);
          } else if (payload.eventType === 'UPDATE') {
            loadCount();
          } else if (payload.eventType === 'DELETE') {
            loadCount();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

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

  // ＋：在 /learning 直接通知记录页打开 LogSheet，其它页先跳转再由 ?log=1 打开
  const openLog = useCallback(() => {
    if (location.pathname === '/learning') {
      window.dispatchEvent(new CustomEvent('yb:open-log'));
    } else {
      nav('/learning?log=1');
    }
  }, [location.pathname, nav]);

  // 导师台 (/mentor) 自带整页布局，不套学生外壳。
  if (location.pathname === '/mentor') {
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
            onClick={() => setProfileEditorOpen(true)}
            aria-label="编辑资料或退出登录"
          >
            {profile.full_name}
          </button>
        )}
      </header>

      {/* key = location.pathname：路由切换时重挂载，触发 120ms 淡入 */}
      <main key={location.pathname} className="main yb-main page-enter">
        <Outlet />
      </main>

      {/* 同一份 DOM，三种形态（见 index.css）：
          ≥920px 浮动侧栏 · 600–919px 图标轨 · <600px 底部玻璃 tab bar */}
      <nav className={'yb-nav' + (shrunk ? ' is-shrunk' : '')} aria-label="主导航">
        <div className="yb-brand">
          <img src={logoInline} alt="" />
          <b>一表人才</b>
        </div>

        <button type="button" className="yb-add" onClick={openLog} aria-label="记一笔">
          <IconPlus />
          <span className="yb-add-label">记一笔</span>
        </button>

        <div className="yb-tabs">
          {finalNavItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) => 'yb-tab' + (isActive ? ' on' : '')}
              aria-label={to === '/notifications' && notificationCount > 0 ? `${label}，${notificationCount} 条未处理` : undefined}
            >
              <span className="yb-tab-icon">
                <Icon />
                {to === '/notifications' && notificationCount > 0 && (
                  <span className="yb-badge">{notificationCount > 99 ? '99+' : notificationCount}</span>
                )}
              </span>
              <span className="yb-tab-label">{label}</span>
            </NavLink>
          ))}
        </div>

        <div className="yb-me">
          <button
            type="button"
            className="yb-me-btn"
            onClick={() => setProfileEditorOpen(true)}
            aria-label="编辑资料"
          >
            <span className="yb-avatar" aria-hidden="true">{initial}</span>
            <span className="yb-me-name">{profile?.full_name || '我的资料'}</span>
          </button>
          <button type="button" className="yb-signout" onClick={handleSignOut}>退出</button>
        </div>
      </nav>

      {profileEditorOpen && (
        <ProfileEditor
          mode="modal"
          onClose={() => setProfileEditorOpen(false)}
        />
      )}
    </div>
  );
}
