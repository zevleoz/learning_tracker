import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import logo from '../logo/crest.png';
import '../styles/student-auth.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── 重置密码链接 ─────────────────────────────────────────────
// 邮件里的链接回到 /login#access_token=…&type=recovery（或失效时 #error=…&error_code=otp_expired）。
// Supabase 在网络校验后会清掉 hash，并用 setTimeout 派发 PASSWORD_RECOVERY，
// 所以在模块加载时就把 URL 参数和事件记下来，不依赖 Login 挂载的时机。
function readAuthUrlParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const merged = new URLSearchParams(window.location.search);
  new URLSearchParams(window.location.hash.slice(1)).forEach((v, k) => merged.set(k, v));
  return merged;
}
const INITIAL_AUTH_PARAMS = readAuthUrlParams();

// 本标签页正处于“设置新密码”流程（刷新页面后仍显示设置新密码表单，1 小时内有效）
const RECOVERY_FLAG = 'ybrc-recovery-pending';
const RECOVERY_TTL_MS = 60 * 60 * 1000;
function markRecoveryPending() {
  try { sessionStorage.setItem(RECOVERY_FLAG, String(Date.now())); } catch { /* 忽略 */ }
}
function clearRecoveryPending() {
  try { sessionStorage.removeItem(RECOVERY_FLAG); } catch { /* 忽略 */ }
}
function isRecoveryPending() {
  try {
    const t = Number(sessionStorage.getItem(RECOVERY_FLAG));
    return Boolean(t) && Date.now() - t < RECOVERY_TTL_MS;
  } catch {
    return false;
  }
}
if (INITIAL_AUTH_PARAMS.get('type') === 'recovery' && INITIAL_AUTH_PARAMS.get('access_token')) {
  markRecoveryPending();
}
supabase.auth.onAuthStateChange?.((event) => {
  if (event === 'PASSWORD_RECOVERY') markRecoveryPending();
});

function clearAuthUrl() {
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  } catch { /* 忽略 */ }
}

// 链接失效时 Supabase 给的错误 → 用户能看懂的话
function recoveryLinkErrorMessage(params) {
  const code = params.get('error_code') || params.get('error') || '';
  if (/otp_expired|expired|access_denied/i.test(code)) {
    return '这个重置链接已失效（链接只能用一次，并且会过期；如果发过多封邮件，只有最新一封有效）。请重新发送重置邮件，并点击最新邮件里的链接。';
  }
  return '重置链接无法使用，请重新发送重置邮件。';
}

// updateUser 失败 → 中文提示
function updatePasswordErrorMessage(error) {
  const code = error?.code || '';
  const msg = error?.message || '';
  if (code === 'same_password' || /different from the old password/i.test(msg)) {
    return '新密码不能和旧密码相同，请换一个';
  }
  if (code === 'weak_password' || /weak|at least/i.test(msg)) {
    return '新密码太简单，请换一个更复杂的密码';
  }
  if (error?.status === 401 || error?.status === 403 || /session|jwt|expired/i.test(code + msg)) {
    return '重置链接已过期，请返回登录页重新发送重置邮件';
  }
  return msg || '密码修改失败，请检查网络连接';
}

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
  // 重置链接失效时显示在登录表单上方，避免用户以为在“设置新密码”页而把新密码填进登录框
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    let alive = true;
    const params = readAuthUrlParams();
    const initial = INITIAL_AUTH_PARAMS;

    // 1) 链接失效 / 已被使用：明确告诉用户，并直接打开“重置密码”弹窗
    if (params.get('error') || params.get('error_code') || initial.get('error') || initial.get('error_code')) {
      const msg = recoveryLinkErrorMessage(params.get('error') || params.get('error_code') ? params : initial);
      clearRecoveryPending();
      setLinkError(msg);
      setShowReset(true);
      toast('重置链接已失效，请重新发送', { kind: 'error' });
      clearAuthUrl();
      return undefined;
    }

    // 2) 正在走重置流程：URL 带 type=recovery，或收到 PASSWORD_RECOVERY，或本标签页刚进入过重置流程
    const fromUrl = (params.get('type') || initial.get('type')) === 'recovery';
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session && alive) {
        markRecoveryPending();
        setRecoveryMode(true);
      }
    });

    if (fromUrl || isRecoveryPending()) {
      // getSession 会等 Supabase 处理完 URL 里的 token 再返回
      supabase.auth.getSession().then(({ data }) => {
        if (!alive) return;
        if (data?.session && (fromUrl || isRecoveryPending())) {
          markRecoveryPending();
          setRecoveryMode(true);
          setEmail(data.session.user?.email || '');
        } else if (fromUrl) {
          clearRecoveryPending();
          setLinkError(recoveryLinkErrorMessage(new URLSearchParams('error_code=otp_expired')));
          setShowReset(true);
          toast('重置链接已失效，请重新发送', { kind: 'error' });
        } else {
          clearRecoveryPending();
        }
        if (fromUrl) clearAuthUrl();
      });
    }

    return () => {
      alive = false;
      authListener?.subscription?.unsubscribe();
    };
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
      toast('密码重置邮件已发送！请检查邮箱（包括垃圾邮件），点击最新一封邮件里的链接', { kind: 'success' });
      setShowReset(false);
      setResetEmail('');
      setLinkError('');
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
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) {
        throw new Error('重置链接已过期，请返回登录页重新发送重置邮件');
      }
      const accountEmail = sess.session.user?.email || '';
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        logger.error('Update password error:', error);
        throw new Error(updatePasswordErrorMessage(error));
      }
      clearRecoveryPending();
      toast('密码修改成功！请用新密码登录', { kind: 'success' });
      await supabase.auth.signOut();
      setRecoveryMode(false);
      setNewPassword('');
      setConfirmPassword('');
      // 回到登录表单时预填邮箱，只需输入刚设置的新密码
      if (accountEmail) setEmail(accountEmail);
      setPw('');
      setErrors({});
      clearAuthUrl();
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
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) throw error;

      toast('登录成功', { kind: 'success' });
      // 角色由 RootRedirect 统一判定（这里不再自己查 profiles，避免读失败就把导师当学生送去 /today）
      nav('/', { replace: true });
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
              onClick={async () => {
                clearRecoveryPending();
                setRecoveryMode(false);
                setNewPassword('');
                setConfirmPassword('');
                clearAuthUrl();
                // 放弃重置：退出这次重置链接带来的临时登录，避免下次打开直接进入账号
                try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* 忽略 */ }
              }}
            >
              返回登录
            </button>
          </form>
        ) : (
          <form className="ya-form" onSubmit={onSubmit} noValidate>
            {linkError && (
              <div className="ya-field" role="alert">
                <p className="ya-error">{linkError}</p>
                <button type="button" className="ya-link" style={{ fontSize: 12.5, alignSelf: 'flex-start' }} onClick={() => setShowReset(true)}>
                  重新发送重置邮件
                </button>
              </div>
            )}
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
              {linkError && <p className="ya-error">{linkError}</p>}
              <p className="ya-note">输入注册邮箱，我们会发送重置链接。收到邮件后点击链接，在打开的“设置新密码”页面里设置新密码。</p>
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
