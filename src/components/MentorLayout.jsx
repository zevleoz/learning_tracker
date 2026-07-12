import { useAuth } from '../lib/useAuth.js';
import logoRed from '../logo/logo_red.png';
import logoColor from '../logo/logo_color.png';

function IconUsers() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconChartBar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <path d="M7 12h2M10 8h2M13 16h2M16 11h2" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const MENU_ITEMS = [
  { id: 'students', label: '学生管理', Icon: IconUsers },
  { id: 'analytics', label: '数据分析', Icon: IconChartBar },
  { id: 'settings', label: '系统设置', Icon: IconSettings },
];

export default function MentorLayout({ children, activeView = 'students', onViewChange }) {
  const { profile, signOut } = useAuth();

  return (
    <div className="mentor-dashboard">
      <aside className="mentor-sidebar">
        <div className="mentor-sidebar-header">
          <img src={logoColor} alt="GPA Tracker" className="mentor-sidebar-logo" />
          <div className="mentor-sidebar-brand">
            <span className="mentor-sidebar-title">一表人才</span>
            <span className="mentor-sidebar-subtitle">导师管理系统</span>
          </div>
        </div>

        <nav className="mentor-sidebar-nav">
          {MENU_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => onViewChange && onViewChange(id)}
              className={`mentor-sidebar-nav-item ${activeView === id ? 'active' : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="mentor-sidebar-footer">
          <div className="mentor-sidebar-user">
            <div className="mentor-sidebar-user-avatar">
              {profile?.full_name?.charAt(0) || 'T'}
            </div>
            <div className="mentor-sidebar-user-info">
              <div className="mentor-sidebar-user-name">{profile?.full_name || '导师'}</div>
              <div className="mentor-sidebar-user-role">教师账号</div>
            </div>
          </div>
          <button className="mentor-sidebar-signout" onClick={signOut}>
            退出登录
          </button>
        </div>
      </aside>

      <main className="mentor-main">
        {children}
      </main>
    </div>
  );
}