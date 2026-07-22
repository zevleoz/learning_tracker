import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
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
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updateBusy, setUpdateBusy] = useState(false);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const type = hashParams.get('type');
    const accessToken = hashParams.get('access_token');
    const code = hashParams.get('code');
    
    if (type === 'recovery' && (accessToken || code)) {
      const checkSession = () => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            setRecoveryMode(true);
          } else {
            toast('链接已过期或无效，请重新请求密码重置', { kind: 'error' });
            window.location.hash = '';
          }
        });
      };

      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) {
          setRecoveryMode(true);
        }
      });

      checkSession();

      return () => {
        authListener?.subscription?.unsubscribe();
      };
    }
  }, []);

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

  async function handleUpdatePassword(e) {
    e.preventDefault();
    if (!newPassword.trim()) return toast('请输入新密码', { kind: 'error' });
    if (newPassword.length < 6) return toast('密码至少 6 位', { kind: 'error' });
    if (newPassword !== confirmPassword) return toast('两次输入的密码不一致', { kind: 'error' });
    setUpdateBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast('密码修改成功！请重新登录', { kind: 'success' });
      await supabase.auth.signOut();
      setRecoveryMode(false);
      setNewPassword('');
      setConfirmPassword('');
      window.location.hash = '';
    } catch (err) {
      toast(err.message || '密码修改失败', { kind: 'error' });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!email || !pw) return toast('请填写邮箱和密码', { kind: 'error' });
    setBusy(true);
    try {
      logger.log('Login attempt:', { email });
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
      logger.log('Login result:', { data, error });
      if (error) throw error;

      const role = Number(data?.user?.user_metadata?.role) || 1;
      logger.log('User role:', role);
      toast('登录成功', { kind: 'success' });
      const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
      nav(role >= 2 ? '/mentor' : (isMobile ? '/learning' : '/syllabus'), { replace: true });
    } catch (err) {
      logger.error('Login error:', err);
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

        {recoveryMode ? (
          <>
            <h1 className="auth-title">设置新密码</h1>
            <p className="auth-subtitle">请设置你的新密码</p>

            <form onSubmit={handleUpdatePassword}>
              <div className="field">
                <label>新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 6 位"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="field">
                <label>确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  required
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                disabled={updateBusy}
                className="btn btn-primary"
                style={{ marginTop: '4px' }}
              >
                {updateBusy ? '设置中…' : '设置新密码'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setRecoveryMode(false);
                  setNewPassword('');
                  setConfirmPassword('');
                  window.location.hash = '';
                }}
                style={{
                  marginTop: '8px', width: '100%', padding: '8px',
                  background: 'transparent', border: 'none',
                  fontSize: '13px', color: '#6366f1', cursor: 'pointer'
                }}
              >
                返回登录
              </button>
            </form>
          </>
        ) : (
          <>
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
          </>
        )}

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
