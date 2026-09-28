import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/useAuth.js';
import { listE4Students } from '../lib/e4Store.js';
import { getRecentStudents, subscribeRecent } from '../lib/e4Recent.js';
import WorkspaceSwitch from './WorkspaceSwitch.jsx';
import logoColor from '../logo/logo_color.png';

function IconStudents() {
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

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconLogOut() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.9" y1="4.9" x2="6.3" y2="6.3" /><line x1="17.7" y1="17.7" x2="19.1" y2="19.1" />
      <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="19.1" x2="6.3" y2="17.7" /><line x1="17.7" y1="6.3" x2="19.1" y2="4.9" />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    let cancelled = false;
    listE4Students()
      .then((all) => { if (!cancelled) setRows(all); })
      .catch(() => { if (!cancelled) setRows([]); });
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = q
      ? rows.filter((s) =>
          [s.display_name, s.grade, s.school, s.y4_student_name]
            .some((v) => String(v || '').toLowerCase().includes(q)))
      : rows;
    return all.slice(0, 20);
  }, [rows, query]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  function go(id) {
    onClose();
    nav(`/e4/students/${id}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      const pick = filtered[active];
      if (pick) { e.preventDefault(); go(pick.id); }
    }
  }

  return createPortal(
    <div className="e4-cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="e4-cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="快速跳转学生"
        initial={{ opacity: 0, y: -8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="e4-cmdk-input-wrap">
          <IconSearch />
          <input
            ref={inputRef}
            className="e4-cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索学生并打开档案…"
          />
          <span className="e4-kbd">ESC</span>
        </div>
        <div className="e4-cmdk-list">
          {filtered.length === 0 ? (
            <div className="e4-cmdk-empty">{query.trim() ? '没有匹配的学生' : '还没有 E4 学生档案'}</div>
          ) : filtered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`e4-cmdk-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(s.id)}
            >
              <span className="e4-student-avatar e4-recent-avatar">{s.display_name?.charAt(0) || '?'}</span>
              <span className="e4-cmdk-item-main">
                <span className="e4-cmdk-name">{s.display_name}</span>
                <span className="e4-cmdk-meta">
                  {[s.grade, s.school].filter(Boolean).join(' · ') || '年级学校未填写'}
                </span>
              </span>
              {s.y4_report_id && (
                <span className="e4-cmdk-meta" style={{ marginLeft: 'auto', flexShrink: 0 }}>已关联 Y4</span>
              )}
            </button>
          ))}
        </div>
        <div className="e4-cmdk-foot">
          <span><span className="e4-kbd">↑</span><span className="e4-kbd">↓</span>切换</span>
          <span><span className="e4-kbd">↵</span>打开</span>
          <span><span className="e4-kbd">ESC</span>关闭</span>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

export default function E4Layout() {
  const { profile, signOut } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recent, setRecent] = useState(getRecentStudents());
  const [theme, setTheme] = useState(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('e4-theme')) || 'dark');

  // 主题挂在 body 上：portal 组件（命令面板/模态框/打印工具条）也能吃到；
  // 不做卸载清理，打印路由在 E4Layout 之外也能保持主题
  useEffect(() => {
    document.body.classList.toggle('e4-light', theme === 'light');
    try { localStorage.setItem('e4-theme', theme); } catch {}
  }, [theme]);

  useEffect(() => subscribeRecent(() => setRecent(getRecentStudents())), []);
  useEffect(() => { setRecent(getRecentStudents()); }, [location.pathname]);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mentor-dashboard e4-dashboard">
      <motion.aside
        className="mentor-sidebar e4-sidebar"
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 28, stiffness: 260, mass: 0.9 }}
      >
        <div className="mentor-sidebar-header e4-sidebar-header">
          <div className="e4-logo-plate">
            <img src={logoColor} alt="凭远 ARK" />
          </div>
          <div className="mentor-sidebar-brand">
            <span className="e4-eyebrow">E4 · LEARN WITH EASE</span>
            <span className="mentor-sidebar-title">学习力导师平台</span>
          </div>
        </div>

        <nav className="mentor-sidebar-nav">
          <span className="e4-nav-label">工作台</span>
          <NavLink
            to="/e4"
            end
            className={({ isActive }) =>
              `mentor-sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <IconCalendar />
            <span>待办事项</span>
          </NavLink>
          <NavLink
            to="/e4/students"
            className={({ isActive }) =>
              `mentor-sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <IconStudents />
            <span>学生中心</span>
          </NavLink>

          <button type="button" className="e4-nav-cmdk" onClick={() => setPaletteOpen(true)}>
            <IconSearch />
            <span>快速跳转</span>
            <span className="e4-kbd">⌘K</span>
          </button>

          {recent.length > 0 && <span className="e4-recent-label">最近查看</span>}
          {recent.slice(0, 5).map((r) => (
            <button
              key={r.id}
              type="button"
              className="e4-recent-item"
              onClick={() => nav(`/e4/students/${r.id}`)}
            >
              <span className="e4-recent-avatar">{r.name?.charAt(0) || '?'}</span>
              <span className="e4-recent-name">{r.name}</span>
            </button>
          ))}
        </nav>

        <div className="mentor-sidebar-footer">
          <WorkspaceSwitch target="tracker" className="e4-switch" />
          <div className="mentor-sidebar-user">
            <div className="mentor-sidebar-user-avatar">
              {profile?.full_name?.charAt(0) || 'T'}
            </div>
            <div className="mentor-sidebar-user-info">
              <div className="mentor-sidebar-user-name">{profile?.full_name || '导师'}</div>
              <div className="mentor-sidebar-user-role">E4 导师账号</div>
            </div>
          </div>

          <button
            type="button"
            className="e4-theme-toggle"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <IconMoon /> : <IconSun />}
            <span>{theme === 'light' ? '深色模式' : '浅色模式'}</span>
          </button>

          <motion.button
            className="mentor-sidebar-signout"
            onClick={() => {
              signOut();
              nav('/login', { replace: true });
            }}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
          >
            <IconLogOut />
            <span>退出登录</span>
          </motion.button>
        </div>
      </motion.aside>

      <motion.main
        className="mentor-main"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
      >
        <Outlet />
      </motion.main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
