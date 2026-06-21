import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { toast, useToasts } from '../lib/toast.js';
import logo from '../logo/logo_color.png';

export default function Signup() {
  const nav = useNavigate();
  const toasts = useToasts();
  const [form, setForm] = useState({ name: '', email: '', password: '', school: '', role: '1' });
  const [busy, setBusy] = useState(false);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.email.trim()) return toast('请填写邮箱', { kind: 'error' });
    if (form.password.length < 6) return toast('密码至少 6 位', { kind: 'error' });
    const role = Number(form.role) || 1;
    if (role === 1 && !form.school.trim()) return toast('请填写学校名称', { kind: 'error' });

    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
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

      // 显式同步到 public.profiles（防止 auth trigger 漏同步 role/school_name）
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
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
        console.warn('profile sync failed:', syncErr);
        // 非致命，继续流程
      }

      toast(
        role >= 2
          ? '老师账号已创建。你可以邀请学生，学生接受后即可看到他的学习数据。'
          : '账号已创建，开始添加课程吧！',
        { kind: 'success' }
      );
      nav(role >= 2 ? '/mentor' : '/syllabus', { replace: true });
    } catch (err) {
      console.error('signup error:', err);
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
            <label>昵称 <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>可选</span></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="如：小王"
              autoComplete="nickname"
            />
          </div>

          <div className="field">
            <label>邮箱</label>
            <input
              type="email" required
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label>密码（至少 6 位）</label>
            <input
              type="password" required
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {Number(form.role) === 1 && (
            <div className="field">
              <label>你的学校 <span style={{ color: 'var(--brand)' }}>*</span></label>
              <input
                type="text" required
                value={form.school}
                onChange={(e) => set('school', e.target.value)}
                placeholder="如：南京市第一中学"
              />
              <p style={{
                fontSize: '12px', color: 'var(--text-soft)',
                marginTop: '6px', marginBottom: 0, lineHeight: 1.5
              }}>
                同校同学可以看到彼此创建的课程大纲，省去重复录入。
              </p>
            </div>
          )}

          <div className="field">
            <label>身份</label>
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
