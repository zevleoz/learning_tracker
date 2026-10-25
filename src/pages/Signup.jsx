import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { AuthBrand, PasswordInput } from './Login.jsx';
import CourseSetup from '../components/student/CourseSetup.jsx';
import '../styles/student-auth.css';

const MOBILE_BREAKPOINT = 767;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAccount(form) {
  const errs = {};
  if (!form.email.trim()) errs.email = '请填写邮箱';
  else if (!EMAIL_RE.test(form.email.trim())) errs.email = '请输入有效的邮箱地址';
  if (form.password.length < 6) errs.password = '密码至少 6 位';
  else if (form.password.length > 128) errs.password = '密码不能超过 128 位';
  return errs;
}

export default function Signup() {
  const nav = useNavigate();
  const toasts = useToasts();
  const [params] = useSearchParams();
  // 只有显式进入 /signup?role=teacher 才是导师注册；角色本身从不取自 user_metadata
  const isTeacher = params.get('role') === 'teacher';

  const [form, setForm] = useState({ name: '', email: '', password: '', school: '', teacherKey: '' });
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);
  const [newUserId, setNewUserId] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function goHome() {
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
    nav(isMobile ? '/learning' : '/syllabus', { replace: true });
  }

  /* ===== 学生：第 1 步（账号）===== */
  function onAccountNext(e) {
    e.preventDefault();
    const errs = validateAccount(form);
    setErrors(errs);
    if (Object.keys(errs).length) return toast(errs.email || errs.password, { kind: 'error' });
    setStep(2);
  }

  /* ===== 学生：第 2 步（关于你）→ 创建账号 ===== */
  async function onAboutSubmit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = '请填写姓名';
    if (!form.school.trim()) errs.school = '请填写学校名称';
    setErrors(errs);
    if (Object.keys(errs).length) return toast(errs.name || errs.school, { kind: 'error' });

    setBusy(true);
    try {
      // signUp 不传 role（避免用户自行提权）；handle_new_user trigger 默认创建 role=1 的 profile
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: { full_name: form.name.trim(), school_name: form.school.trim() },
        },
      });
      if (error) throw error;

      // 有 session 才能写 courses；开了邮箱确认时没有 session，跳过课程步骤，保持原有行为
      if (data?.session && data?.user?.id) {
        setNewUserId(data.user.id);
        setStep(3);
        return;
      }
      toast('账号已创建\n开始添加你的课程大纲吧！', { kind: 'success' });
      nav('/syllabus', { replace: true });
    } catch (err) {
      logger.error('signup error:', err);
      const msg = err?.message || '注册失败，请稍后再试';
      setErrors({ form: msg });
      toast(msg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /* ===== 老师：单页表单，行为与改版前一致 ===== */
  async function onTeacherSubmit(e) {
    e.preventDefault();
    const errs = validateAccount(form);
    if (!form.name.trim()) errs.name = '请填写姓名';
    setErrors(errs);
    if (Object.keys(errs).length) return toast(errs.name || errs.email || errs.password, { kind: 'error' });

    setBusy(true);
    try {
      // 先预校验密钥（快速失败）；signUp 后由 register_teacher RPC 服务端提权
      const { data: ok, error: keyErr } = await supabase.rpc('verify_teacher_key', {
        key_text: form.teacherKey,
      });
      if (keyErr || !ok) {
        setErrors({ teacherKey: '老师注册密钥错误' });
        toast('老师注册密钥错误', { kind: 'error' });
        return;
      }

      const { data: signUpData, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: { full_name: form.name.trim() || form.email.split('@')[0], school_name: '' },
        },
      });
      if (error) throw error;

      const uid = signUpData?.user?.id;
      if (uid) {
        try {
          const { error: elevateErr } = await supabase.rpc('register_teacher', { key_text: form.teacherKey });
          if (elevateErr) {
            logger.error('register_teacher failed:', elevateErr);
            toast('账号已创建，但密钥验证失败，请登录后联系管理员', { kind: 'warning' });
            await supabase.auth.signOut();
            nav('/login', { replace: true });
            return;
          }
        } catch (elevateErr) {
          logger.error('register_teacher error:', elevateErr);
          toast('账号已创建，但导师提权失败，请登录后重试', { kind: 'warning' });
          await supabase.auth.signOut();
          nav('/login', { replace: true });
          return;
        }
        // 提权成功：signOut 后重新登录，确保 profile 和 JWT 刷新
        toast('老师账号已创建\n请重新登录以激活导师权限。', { kind: 'success' });
        await supabase.auth.signOut();
        nav('/login', { replace: true });
        return;
      }
      toast('账号已创建\n开始添加你的课程大纲吧！', { kind: 'success' });
      nav('/syllabus', { replace: true });
    } catch (err) {
      logger.error('signup error:', err);
      const msg = err?.message || '注册失败，请稍后再试';
      setErrors({ form: msg });
      toast(msg, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const err = (id, msg) => msg && <p id={id} className="ya-error" role="alert">{msg}</p>;

  function renderStudent() {
    if (step === 3) {
      return (
        <CourseSetup
          userId={newUserId}
          onDone={(count) => {
            if (count === 0) toast('账号已创建', { kind: 'success' });
            goHome();
          }}
        />
      );
    }
    return (
      <>
        <div className="ya-steps" aria-hidden="true">
          <i className="on" /><i className={step >= 2 ? 'on' : ''} /><i />
        </div>
        <div className="ya-eyebrow">第 {step} 步，共 3 步 · {step === 1 ? '账号' : '关于你'}</div>

        {step === 1 ? (
          <form className="ya-form" onSubmit={onAccountNext} noValidate>
            <h1 className="ya-h1">创建账号</h1>
            <div className="ya-field">
              <label className="ya-label" htmlFor="su-email">邮箱</label>
              <input
                id="su-email" className="ya-input" type="email" value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="you@school.edu" autoComplete="email"
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'su-email-err' : undefined}
              />
              {err('su-email-err', errors.email)}
            </div>
            <div className="ya-field">
              <label className="ya-label" htmlFor="su-pw">密码 <small>至少 6 位</small></label>
              <PasswordInput
                id="su-pw" value={form.password} onChange={(e) => set('password', e.target.value)}
                autoComplete="new-password" invalid={!!errors.password}
                describedBy={errors.password ? 'su-pw-err' : undefined}
              />
              {err('su-pw-err', errors.password)}
            </div>
            <button type="submit" className="ya-btn" style={{ marginTop: 6 }}>下一步</button>
          </form>
        ) : (
          <form className="ya-form" onSubmit={onAboutSubmit} noValidate>
            <h1 className="ya-h1">介绍一下你</h1>
            <p className="ya-note">导师邀请你、查看你的记录时，会看到这些信息。</p>
            <div className="ya-field">
              <label className="ya-label" htmlFor="su-name">姓名</label>
              <input
                id="su-name" className="ya-input" type="text" value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="如：陈一舟" autoComplete="name" maxLength={40}
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? 'su-name-err' : undefined}
              />
              {err('su-name-err', errors.name)}
            </div>
            <div className="ya-field">
              <label className="ya-label" htmlFor="su-school">学校 <small>以后可以在「我的」里修改</small></label>
              <input
                id="su-school" className="ya-input" type="text" value={form.school}
                onChange={(e) => set('school', e.target.value)}
                placeholder="如：南京市第一中学" autoComplete="organization" maxLength={60}
                aria-invalid={errors.school ? 'true' : undefined}
                aria-describedby={errors.school ? 'su-school-err' : undefined}
              />
              {err('su-school-err', errors.school)}
            </div>
            {err('su-form-err', errors.form)}
            <div className="ya-spacer" />
            <button type="submit" className="ya-btn" disabled={busy}>{busy ? '创建中…' : '下一步'}</button>
            <button type="button" className="ya-btn secondary" disabled={busy} onClick={() => setStep(1)}>上一步</button>
          </form>
        )}

        <div className="ya-foot small">
          我是老师？<Link to="/signup?role=teacher" className="ya-link">使用导师注册</Link>
        </div>
      </>
    );
  }

  function renderTeacher() {
    return (
      <form className="ya-form" onSubmit={onTeacherSubmit} noValidate>
        <div className="ya-eyebrow">导师注册</div>
        <h1 className="ya-h1">创建导师账号</h1>
        <p className="ya-note">注册后可以向学生发送邀请，学生接受后你就能看到他的学习数据。</p>
        <div className="ya-field">
          <label className="ya-label" htmlFor="tr-name">姓名</label>
          <input
            id="tr-name" className="ya-input" type="text" value={form.name}
            onChange={(e) => set('name', e.target.value)} autoComplete="name" maxLength={40}
            aria-invalid={errors.name ? 'true' : undefined}
          />
          {err('tr-name-err', errors.name)}
        </div>
        <div className="ya-field">
          <label className="ya-label" htmlFor="tr-email">邮箱</label>
          <input
            id="tr-email" className="ya-input" type="email" value={form.email}
            onChange={(e) => set('email', e.target.value)} autoComplete="email"
            aria-invalid={errors.email ? 'true' : undefined}
          />
          {err('tr-email-err', errors.email)}
        </div>
        <div className="ya-field">
          <label className="ya-label" htmlFor="tr-pw">密码 <small>至少 6 位</small></label>
          <PasswordInput
            id="tr-pw" value={form.password} onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password" invalid={!!errors.password}
          />
          {err('tr-pw-err', errors.password)}
        </div>
        <div className="ya-field">
          <label className="ya-label" htmlFor="tr-key">老师注册密钥</label>
          <input
            id="tr-key" className="ya-input" type="password" value={form.teacherKey}
            onChange={(e) => set('teacherKey', e.target.value)}
            placeholder="请联系管理员获取" autoComplete="off"
            aria-invalid={errors.teacherKey ? 'true' : undefined}
          />
          {err('tr-key-err', errors.teacherKey)}
        </div>
        {err('tr-form-err', errors.form)}
        <button type="submit" className="ya-btn" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? '创建中…' : '创建导师账号'}
        </button>
        <div className="ya-foot small">
          <Link to="/signup" className="ya-link">我是学生，返回学生注册</Link>
        </div>
      </form>
    );
  }

  return (
    <div className="ya-page">
      <div className="ya-col">
        {step < 3 && <AuthBrand />}
        {isTeacher ? renderTeacher() : renderStudent()}
        {step < 3 && (
          <>
            <div className="ya-spacer" />
            <div className="ya-foot">已有账号？ <Link to="/login" className="ya-link">直接登录</Link></div>
          </>
        )}
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind || '')}>{t.title}</div>
        ))}
      </div>
    </div>
  );
}
