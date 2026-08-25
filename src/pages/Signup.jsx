import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import logo from '../logo/logo_color.png';

const COMMON_SCHOOLS = [
  '南京市第一中学',
  '北京师范大学附属中学',
  '上海市格致中学',
  '广州市执信中学',
  '深圳市深圳中学',
];

export default function Signup() {
  const nav = useNavigate();
  const toasts = useToasts();
  const [form, setForm] = useState({ name: '', email: '', password: '', school: '', role: '1', teacherKey: '' });
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [schoolSuggestions, setSchoolSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  useEffect(() => {
    async function loadSchools() {
      const { data, error } = await supabase
        .from('profiles')
        .select('school_name')
        .not('school_name', 'is', null)
        .not('school_name', 'eq', '')
        .limit(50);
      if (!error) {
        const schools = Array.from(new Set((data || []).map((p) => p.school_name)));
        setSchoolSuggestions(schools);
      }
    }
    loadSchools();
  }, []);

  function handleSchoolChange(e) {
    const value = e.target.value;
    set('school', value);
    setShowSuggestions(value.length > 0);
  }

  function selectSchool(school) {
    set('school', school);
    setShowSuggestions(false);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return toast('请填写昵称', { kind: 'error' });
    if (!form.email.trim()) return toast('请填写邮箱', { kind: 'error' });
    // 基本邮箱格式校验，避免无效邮箱提交到 Supabase
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(form.email.trim())) return toast('请输入有效的邮箱地址', { kind: 'error' });
    if (form.password.length < 6) return toast('密码至少 6 位', { kind: 'error' });
    if (form.password.length > 128) return toast('密码不能超过 128 位', { kind: 'error' });
    const role = Number(form.role) || 1;
    if (role === 1 && !form.school.trim()) return toast('请填写学校名称', { kind: 'error' });

    setBusy(true);
    try {
      // 老师注册密钥：调用后端 RPC 校验哈希，避免明文密钥暴露在前端
      if (role === 2) {
        const { data: ok, error: keyErr } = await supabase.rpc('verify_teacher_key', {
          key_text: form.teacherKey,
        });
        if (keyErr || !ok) {
          toast('老师注册密钥错误', { kind: 'error' });
          return;
        }
      }
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            full_name: form.name.trim() || form.email.split('@')[0],
            school_name: form.school.trim() || '',
            role,
          }
        }
      });
      if (error) throw error;

      // Use signUpData.user.id (always the new user's ID) instead of getSession()
      // getSession() may return a previous mentor's session if email confirmation is enabled
      try {
        const uid = signUpData?.user?.id;
        if (uid) {
          await supabase.from('profiles').upsert({
            id: uid,
            full_name: form.name.trim() || form.email.split('@')[0],
            school_name: form.school.trim() || '',
            role,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'id' });
        }
      } catch (syncErr) {
        logger.warn('profile sync failed:', syncErr);
      }

      toast(
        role >= 2
          ? '老师账号已创建 🎉\n现在可以向学生发送邀请，学生接受后即可看到他的学习数据。'
          : '账号已创建 🎉\n开始添加你的课程大纲吧！',
        { kind: 'success' }
      );
      nav(role >= 2 ? '/mentor' : '/syllabus', { replace: true });
    } catch (err) {
      logger.error('signup error:', err);
      toast(err.message || '注册失败，请稍后再试', { kind: 'error' });
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

        <h1 className="auth-title">创建账号</h1>
        <p className="auth-subtitle">加入后与同校同学共享课程大纲</p>

        <form onSubmit={onSubmit}>
          <div className="field">
            <label>昵称 <span style={{ color: 'var(--brand)' }}>*</span></label>
            <input
              type="text" required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="如：小王"
              autoComplete="nickname"
            />
          </div>

          <div className="field">
            <label>邮箱 <span style={{ color: 'var(--brand)' }}>*</span></label>
            <input
              type="email" required
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>密码（至少 6 位）<span style={{ color: 'var(--brand)' }}>*</span></label>
            <input
              type="password" required
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {Number(form.role) === 1 && (
            <div className="field" style={{ position: 'relative' }}>
              <label>你的学校 <span style={{ color: 'var(--brand)' }}>*</span></label>
              <input
                type="text" required
                value={form.school}
                onChange={handleSchoolChange}
                onFocus={() => setShowSuggestions(form.school.length > 0)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                placeholder="如：南京市第一中学"
              />
              <p style={{
                fontSize: '12px', color: 'var(--text-soft)',
                marginTop: '6px', marginBottom: 0, lineHeight: 1.5
              }}>
                同校同学可以看到彼此创建的课程大纲，省去重复录入。
              </p>
              
              {showSuggestions && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: 'white', borderRadius: '10px',
                  boxShadow: '0 4px 20px rgba(15,23,42,0.1)',
                  border: '1px solid rgba(15,23,42,0.08)',
                  zIndex: 100, maxHeight: '200px', overflowY: 'auto',
                }}>
                  {(schoolSuggestions.length > 0 ? schoolSuggestions : COMMON_SCHOOLS)
                    .filter((s) => s.toLowerCase().includes(form.school.toLowerCase()))
                    .slice(0, 8)
                    .map((school) => (
                      <button
                        key={school}
                        type="button"
                        onClick={() => selectSchool(school)}
                        style={{
                          display: 'block', width: '100%',
                          padding: '10px 14px', textAlign: 'left',
                          fontSize: '13px', color: '#334155',
                          background: 'transparent', border: 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'rgba(99,102,241,0.06)'}
                        onMouseLeave={(e) => e.target.style.background = 'transparent'}
                      >
                        {school}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label>身份 <span style={{ color: 'var(--brand)' }}>*</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                border: form.role === '1' ? '1px solid #6366f1' : '1px solid rgba(100,116,139,0.35)',
                background: form.role === '1' ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <input type="radio" name="role" value="1"
                       checked={form.role === '1'}
                       onChange={(e) => set('role', e.target.value)} />
                <span style={{ fontSize: '13px', color: '#0f172a' }}>我是学生</span>
              </label>
              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                border: form.role === '2' ? '1px solid #6366f1' : '1px solid rgba(100,116,139,0.35)',
                background: form.role === '2' ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <input type="radio" name="role" value="2"
                       checked={form.role === '2'}
                       onChange={(e) => set('role', e.target.value)} />
                <span style={{ fontSize: '13px', color: '#0f172a' }}>我是老师</span>
              </label>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-soft)', margin: '6px 0 0 0', lineHeight: 1.5 }}>
              {Number(form.role) === 2
                ? '老师不需要填写学校。注册后可以向学生发送邀请，学生接受后你就能看到他的学习数据。'
                : '学生端用于记录学习，老师端用于查看与反馈。'}
            </p>
          </div>

          {Number(form.role) === 2 && (
            <div className="field">
              <label>老师注册密钥 <span style={{ color: 'var(--brand)' }}>*</span></label>
              <input
                type="password"
                value={form.teacherKey}
                onChange={(e) => set('teacherKey', e.target.value)}
                placeholder="请输入老师注册密钥"
                autoComplete="off"
              />
              <p style={{
                fontSize: '11px', color: '#94a3b8',
                marginTop: '6px', marginBottom: 0, lineHeight: 1.5
              }}>
                请联系管理员获取注册密钥。
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary"
            style={{ marginTop: '6px' }}
          >
            {busy ? '创建中…' : '创建账号'}
          </button>
        </form>

        <div className="auth-link-row">
          <span>已有账号？</span>
          <Link to="/login">直接登录</Link>
        </div>
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.kind || '')}>{t.title}</div>
        ))}
      </div>
    </div>
  );
}
