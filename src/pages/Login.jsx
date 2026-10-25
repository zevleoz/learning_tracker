import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import logo from '../logo/logo_color.png';
import '../styles/student-auth.css';

const MOBILE_BREAKPOINT = 767;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthBrand() {
  return (
    <div className="ya-brand">
      <img src={logo} alt="" />
      <div className="ya-brand-name">一表人才</div>
      <div className="ya-brand-motto">WORK HARD · DREAM BIG</div>
    </div>
  );
}

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

// 密码输入框 + 显示/隐藏切换
export function PasswordInput({ id, value, onChange, placeholder, autoComplete, invalid, describedBy }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="ya-input-wrap">
      <input
        id={id}
        className="ya-input has-action"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        className="ya-eye"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? '隐藏密码' : '显示密码'}
        aria-pressed={shown}
      >
        <EyeIcon off={shown} />
      </button>
    </div>
  );
}

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
  const [errors, setErrors] = useState({});

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
    const next = {};
    if (!email.trim()) next.email = '请填写邮箱';
    else if (!EMAIL_RE.test(email.trim())) next.email = '请输入有效的邮箱地址';
    if (!pw) next.pw = '请填写密码';
    setErrors(next);
    if (next.email || next.pw) {
      return toast(next.email && next.pw ? '请填写邮箱和密码' : (next.email || next.pw), { kind: 'error' });
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
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
      // 导师/管理员落到根路由，由 default_workspace 偏好决定进入 E4（默认）或一表人才
      nav(role >= 2 ? '/' : (isMobile ? '/learning' : '/syllabus'), { replace: true });
    } catch (err) {
      // 统一错误消息，避免账户枚举（不区分"用户不存在"和"密码错误"）
      const msg = err?.message || '登录失败，请检查邮箱和密码';
      const safeMsg = /Invalid login credentials|Invalid credentials/i.test(msg)
        ? '邮箱或密码错误'
        : msg;
      setErrors({ pw: safeMsg });
      toast(safeMsg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ya-page">
      <div className="ya-col">
        <AuthBrand />

        {recoveryMode ? (
          <form className="ya-form" onSubmit={handleUpdatePassword} noValidate>
            <h1 className="ya-h1">设置新密码</h1>
            <p className="ya-note">请设置你的新密码</p>

            <div className="ya-field">
              <label className="ya-label" htmlFor="login-new-pw">新密码</label>
              <PasswordInput
                id="login-new-pw" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位" autoComplete="new-password"
              />
            </div>
            <div className="ya-field">
              <label className="ya-label" htmlFor="login-confirm-pw">确认密码</label>
              <PasswordInput
                id="login-confirm-pw" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码" autoComplete="new-password"
              />
            </div>

            <button type="submit" disabled={updateBusy} className="ya-btn">
              {updateBusy ? '设置中…' : '设置新密码'}
            </button>
            <button
              type="button"
              className="ya-btn secondary"
              onClick={() => {
                setRecoveryMode(false);
                setNewPassword('');
                setConfirmPassword('');
                window.location.hash = '';
              }}
            >
              返回登录
            </button>
          </form>
        ) : (
          <form className="ya-form" onSubmit={onSubmit} noValidate>
            <div className="ya-field">
              <label className="ya-label" htmlFor="login-email">邮箱</label>
              <input
                id="login-email"
                className="ya-input"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((x) => ({ ...x, email: undefined })); }}
                placeholder="your@email.com"
                autoComplete="email"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'login-email-err' : undefined}
              />
              {errors.email && <p id="login-email-err" className="ya-error" role="alert">{errors.email}</p>}
            </div>

            <div className="ya-field">
              <div className="ya-label">
                <label htmlFor="login-pw">密码</label>
                <button type="button" className="ya-link" style={{ fontSize: 12.5 }} onClick={() => setShowReset(true)}>
                  忘记密码？
                </button>
              </div>
              <PasswordInput
                id="login-pw" value={pw}
                onChange={(e) => { setPw(e.target.value); if (errors.pw) setErrors((x) => ({ ...x, pw: undefined })); }}
                placeholder="至少 6 位" autoComplete="current-password"
                invalid={!!errors.pw} describedBy={errors.pw ? 'login-pw-err' : undefined}
              />
              {errors.pw && <p id="login-pw-err" className="ya-error" role="alert">{errors.pw}</p>}
            </div>

            <button type="submit" disabled={busy} className="ya-btn" style={{ marginTop: 6 }}>
              {busy ? '登录中…' : '登录'}
            </button>
          </form>
        )}

        {showReset && (
          <div className="ya-overlay" onClick={() => !resetBusy && setShowReset(false)}>
            <div
              className="ya-modal" role="dialog" aria-modal="true" aria-label="重置密码"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>重置密码</h3>
              <p className="ya-note">输入注册邮箱，我们会发送重置链接</p>
              <form className="ya-form" onSubmit={handleReset} noValidate>
                <div className="ya-field">
                  <label className="ya-label" htmlFor="reset-email">邮箱</label>
                  <input
                    id="reset-email" className="ya-input" type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="your@email.com" autoComplete="email"
                  />
                </div>
                <button type="submit" disabled={resetBusy} className="ya-btn">
                  {resetBusy ? '发送中…' : '发送重置邮件'}
                </button>
              </form>
              <button type="button" className="ya-btn secondary" onClick={() => setShowReset(false)} disabled={resetBusy}>
                取消
              </button>
            </div>
          </div>
        )}

        <div className="ya-spacer" />
        <div className="ya-foot">
          还没有账号？ <Link to="/signup" className="ya-link">注册</Link>
        </div>
        <div className="ya-foot small">老师账号同样在这里登录，登录后自动进入导师视图</div>
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind || '')}>{t.title}</div>
        ))}
      </div>
    </div>
  );
}
