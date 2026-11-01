import { useNavigate } from 'react-router-dom';
import { useAuth, retryProfile } from '../lib/useAuth.js';

/**
 * 角色读取失败：不知道是学生还是导师时，不套任何一方的外壳，只给一个中性的提示页。
 * （不知道角色 ≠ 学生，所以绝不能按学生界面先放行。）
 */
export default function RoleLoadError() {
  const nav = useNavigate();
  const { signOut } = useAuth();

  async function exit() {
    await signOut();
    nav('/login', { replace: true });
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f8fafc',
      }}
    >
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ fontSize: 15, color: '#334155', lineHeight: 1.7, marginBottom: 20 }}>
          账号信息读取失败，请检查网络后重试
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => retryProfile()}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              color: '#fff',
              background: '#0f172a',
              border: '1px solid #0f172a',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={exit}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              color: '#475569',
              background: 'transparent',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
