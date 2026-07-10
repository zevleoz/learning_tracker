import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import logo from '../logo/logo_color.png';

const MOBILE_BREAKPOINT = 767;

export default function Login() {
  const nav = useNavigate();
  const toasts = useToasts();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  async function handleReset(e) {
    e.preventDefault();
    if (!resetEmail.trim()) return toast('请填写邮箱', { kind: 'error' });
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin + '/login'
      });
      if (error) throw error;
      toast('密码重置邮件已发送！请检查邮箱', { kind: 'success' });
      setShowReset(false);
      setResetEmail('');
    } catch (err) {
      toast(err.message || '发送失败', { kind: 'error' });
    } finally {
      setResetBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!email || !pw) return toast('请填写邮箱和密码', { kind: 'error' });
    setBusy(true);
    try {
      console.log('Login attempt:', { email });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
      console.log('Login result:', { data, error });
      if (error) throw error;

      const role = Number(data?.user?.user_metadata?.role) || 1;
      console.log('User role:', role);
      toast('登录成功', { kind: 'success' });
      const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
      nav(role >= 2 ? '/mentor' : (isMobile ? '/learning' : '/syllabus'), { replace: true });
    } catch (err) {
      console.error('Login error:', err);
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

          <button
            type="button"
            onClick={() => setShowReset(true)}
            style={{
              marginTop: '8px', width: '100%', padding: '8px',
              background: 'transparent', border: 'none',
              fontSize: '13px', color: '#6366f1', cursor: 'pointer'
            }}
          >
            忘记密码？
          </button>
        </form>

        {showReset && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '24px',
              width: '90%', maxWidth: '320px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>重置密码</h3>
              <form onSubmit={handleReset}>
                <div className="field">
                  <label>邮箱</label>
                  <input
                    type="email" required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="your@email.com"
                    autoComplete="email"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resetBusy}
                  className="btn btn-primary"
                  style={{ marginTop: '8px' }}
                >
                  {resetBusy ? '发送中…' : '发送重置邮件'}
                </button>
              </form>
              <button
                onClick={() => setShowReset(false)}
                style={{
                  marginTop: '12px', width: '100%', padding: '10px',
                  background: 'rgba(15,23,42,0.06)', border: 'none',
                  borderRadius: '10px', fontSize: '14px', color: '#475569', cursor: 'pointer'
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}

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
