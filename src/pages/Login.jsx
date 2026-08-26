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
    if (!resetEmail.includes('@') || !resetEmail.includes('.')) {
      return toast('请输入有效的邮箱地址', { kind: 'error' });
    }
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin + '/login'
      });
      if (error) {
        logger.error('Reset password error:', error);
        if (error.status === 429) {
          throw new Error('请求过于频繁，请稍后再试');
        }
        if (error.status === 500) {
          throw new Error('服务器发送邮件失败，请联系管理员');
        }
        throw error;
      }
      toast('密码重置邮件已发送！请检查邮箱（包括垃圾邮件）', { kind: 'success' });
      setShowReset(false);
      setResetEmail('');
    } catch (err) {
      logger.error('Reset password catch error:', err);
      toast(err.message || '发送失败，请检查网络连接', { kind: 'error' });
    } finally {
      setResetBusy(false);
    }
  }

  async function handleUpdatePassword(e) {
    e.preventDefault();
    if (!newPassword.trim()) return toast('请输入新密码', { kind: 'error' });
    if (newPassword.length < 6) return toast('密码至少 6 位', { kind: 'error' });
    if (newPassword !== confirmPassword) return toast('两次输入的密码不一致', { kind: 'error' });
    if (newPassword.length > 128) return toast('密码不能超过 128 位', { kind: 'error' });
    setUpdateBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        logger.error('Update password error:', error);
        if (error.status === 400) {
          throw new Error('无效的密码重置链接，请重新请求');
        }
        if (error.status === 401) {
          throw new Error('登录状态已过期，请重新请求密码重置');
        }
        throw error;
      }
      toast('密码修改成功！请重新登录', { kind: 'success' });
      await supabase.auth.signOut();
      setRecoveryMode(false);
      setNewPassword('');
      setConfirmPassword('');
      window.location.hash = '';
    } catch (err) {
      logger.error('Update password catch error:', err);
      toast(err.message || '密码修改失败，请检查网络连接', { kind: 'error' });
    } finally {
      setUpdateBusy(false);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!email || !pw) return toast('请填写邮箱和密码', { kind: 'error' });
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;

      // 从 profiles 表读取权威 role（signUp 时不再把 role 写入 user_metadata，
      // 因此不能用 user_metadata.role 决定跳转，否则导师会被错误跳到 /syllabus）
      let role = 1;
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', data.user.id)
          .maybeSingle();
        if (profile?.role != null) role = Number(profile.role);
      } catch (profileErr) {
        // profile 读取失败时降级为默认学生角色，避免阻塞登录
        logger.warn('Login profile load failed, fallback to role=1:', profileErr);
      }

      toast('登录成功', { kind: 'success' });
      const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
      nav(role >= 2 ? '/mentor' : (isMobile ? '/learning' : '/syllabus'), { replace: true });
    } catch (err) {
      // 统一错误消息，避免账户枚举（不区分"用户不存在"和"密码错误"）
      const msg = err?.message || '登录失败，请检查邮箱和密码';
      const safeMsg = /Invalid login credentials|Invalid credentials/i.test(msg)
        ? '邮箱或密码错误'
        : msg;
      toast(safeMsg, { kind: 'error' });
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
                className="btn btn-ghost"
                style={{ marginTop: '8px' }}
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
                  fontSize: '13px', color: 'var(--brand)', cursor: 'pointer',
                  fontWeight: 500, fontFamily: 'inherit',
                  transition: 'opacity 120ms ease',
                }}
                onMouseEnter={(e) => e.target.style.opacity = '0.7'}
                onMouseLeave={(e) => e.target.style.opacity = '1'}
              >
                忘记密码？
              </button>
            </form>
          </>
        )}

        {showReset && (
          <div
            className="auth-modal-overlay"
            style={{
              position: 'fixed', inset: 0, zIndex: 1000,
              background: 'rgba(15,23,42,0.35)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 20, animation: 'fadeIn 180ms ease-out',
            }}
            onClick={() => !resetBusy && setShowReset(false)}
          >
            <div
              className="auth-modal-card"
              style={{
                background: 'var(--glass-strong)',
                backdropFilter: 'var(--blur-sheet)',
                WebkitBackdropFilter: 'var(--blur-sheet)',
                borderRadius: 20, padding: 24,
                width: '100%', maxWidth: 340,
                border: '1px solid var(--edge-bright)',
                boxShadow: '0 2px 6px rgba(15,23,42,0.04), 0 18px 44px rgba(15,23,42,0.12)',
                animation: 'authModalIn 220ms cubic-bezier(0.32,0.72,0,1)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>重置密码</h3>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-soft)' }}>输入注册邮箱，我们会发送重置链接</p>
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
                disabled={resetBusy}
                className="btn btn-ghost"
                style={{ marginTop: '8px' }}
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
          color: 'var(--text-soft)', background: 'var(--brand-soft)',
          border: '1px solid rgba(193,39,45,0.15)', borderRadius: '10px', lineHeight: 1.55,
        }}>
          <b style={{ color: 'var(--brand)' }}>🧑‍🏫 老师登录：</b>
          使用你注册时选择"我是老师"所填的邮箱和密码登录；登录后会自动进入
          <b style={{ color: 'var(--brand)' }}>导师视图</b>，可下拉选择任意学生查看其 Review。
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
