import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { lastWorkspacePath } from '../lib/workspaceNav.js';

// 一表人才 ⇄ E4 一键切换（仅导师/管理员侧使用）。
// 切到对方平台后回到上次停留的页面，Back 也就退回切换前的页面。
export default function WorkspaceSwitch({ target = 'e4', className = '' }) {
  const nav = useNavigate();
  const toE4 = target === 'e4';
  return (
    <motion.button
      type="button"
      onClick={() => nav(lastWorkspacePath(toE4 ? 'e4' : 'tracker'))}
      className={`workspace-switch ${className}`}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.98 }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
      <span>{toE4 ? '前往 E4 学习力平台' : '前往 一表人才'}</span>
    </motion.button>
  );
}
