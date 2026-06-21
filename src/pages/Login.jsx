import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import logo from '../logo/logo_color.png';

export default function Login() {
  const nav = useNavigate();
  const toasts = useToasts();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!email || !pw) return toast('请填写邮箱和密码', { kind: 'error' });
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;

      // 根据角色路由：老师 → /mentor，学生 → /syllabus
      const role = Number(data?.user?.user_metadata?.role) || 1;
      toast('登录成功', { kind: 'success' });
      nav(role >= 2 ? '/mentor' : '/syllabus', { replace: true });
    } catch (err) {
      toast(err.message || '登录失败', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={logo} alt="logo" />
        </div>

        <h1 className="auth-title">欢迎回来</h1>
        <p className="auth-subtitle">登录你的账号继续使用</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>密码</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="至少 6 位"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary"
            style={{ marginTop: '4px' }}
          >
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <div className="auth-link-row">
          <span>还没有账号？</span>
          <Link to="/signup">注册一个</Link>
        </div>

        <div style={{
          marginTop: '14px', padding: '10px 12px', fontSize: '12px',
          color: '#475569', background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', lineHeight: 1.55,
        }}>
          <b style={{ color: '#4338ca' }}>🧑‍🏫 老师登录：</b>
          使用你注册时选择"我是老师"所填的邮箱和密码登录；登录后会自动进入
          <b style={{ color: '#4338ca' }}>导师视图</b>，可下拉选择任意学生查看其 Review。
        </div>
      </div>

      {/* Toast */}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind || '')}>{t.title}</div>
        ))}
      </div>
    </div>
  );
}
