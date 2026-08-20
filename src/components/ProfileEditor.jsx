import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { useAuth } from '../lib/useAuth.js';

/**
 * ProfileEditor — reusable editor for full_name and school_name.
 *
 * Props:
 *   - mode: 'inline' (default, renders a card) | 'modal' (renders an overlay)
 *   - onClose: function (required for modal mode)
 *   - forceSchool: bool — if true, always show school field (e.g. mentor editing a student)
 *   - externalUser: object — if provided, edit someone else's profile (mentor editing student)
 *     shape: { id, full_name, school_name }
 *   - onSaved: function (profile) — called after successful save
 */
export default function ProfileEditor({
  mode = 'inline',
  onClose,
  forceSchool = false,
  externalUser = null,
  onSaved,
}) {
  const { user, profile, signOut } = useAuth();
  const target = externalUser || profile;
  const isEditingOther = !!externalUser;

  const [fullName, setFullName] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [busy, setBusy] = useState(false);

  // Pre-fill from target profile or user_metadata
  useEffect(() => {
    if (!target) return;
    const name =
      target.full_name ||
      target.user_metadata?.full_name ||
      target.email?.split('@')[0] ||
      '';
    const school = target.school_name ?? target.user_metadata?.school_name ?? '';
    setFullName(name);
    setSchoolName(school);
  }, [target?.id, target?.full_name, target?.school_name]);

  const role = Number(target?.role || profile?.role || 1);
  const isStudent = role < 2;
  const showSchool = forceSchool || isStudent;

  async function handleSave(e) {
    e?.preventDefault?.();
    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast('昵称不能为空', { kind: 'error' });
      return;
    }
    const trimmedSchool = schoolName.trim();

    setBusy(true);
    try {
      // Branch 1: mentor editing a student's profile → use RPC (avoids RLS issues)
      if (isEditingOther) {
        const { error } = await supabase.rpc('update_student_school', {
          p_student_id: externalUser.id,
          p_school_name: trimmedSchool,
        });
        if (error) throw error;
        // Also update the student's name via a separate RPC for consistency
        const { error: nameErr } = await supabase.rpc('update_student_name', {
          p_student_id: externalUser.id,
          p_full_name: trimmedName,
        });
        if (nameErr) throw nameErr;
        toast('已更新学生信息', { kind: 'success' });
        onSaved?.({ ...externalUser, full_name: trimmedName, school_name: trimmedSchool });
        onClose?.();
        return;
      }

      // Branch 2: editing own profile
      const uid = user?.id || profile?.id;
      if (!uid) throw new Error('无法获取当前用户 ID');

      // 1) Update auth.users.user_metadata (triggers on_auth_user_updated_profile)
      const { error: authErr } = await supabase.auth.updateUser({
        data: { full_name: trimmedName, school_name: trimmedSchool },
      });
      if (authErr) {
        logger.warn('auth.updateUser failed (continuing with direct update):', authErr);
      }

      // 2) Direct update on profiles table (immediate, doesn't rely on trigger timing)
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          school_name: showSchool ? trimmedSchool : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', uid);
      if (profileErr) throw profileErr;

      toast('资料已更新', { kind: 'success' });
      onSaved?.({ id: uid, full_name: trimmedName, school_name: trimmedSchool });
      onClose?.();
    } catch (err) {
      logger.error('ProfileEditor save failed:', err);
      toast(err.message || '保存失败，请稍后再试', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const initials = (target?.full_name || target?.email || 'U').charAt(0).toUpperCase();
  const email = target?.email || user?.email;
  const roleLabel = role >= 2 ? (role >= 3 ? '管理员' : '导师') : '学生';

  const form = (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 700, flexShrink: 0,
        }}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {target?.full_name || '(未设置昵称)'}
          </div>
          {email && (
            <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </div>
          )}
          <div style={{
            display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 600,
            padding: '2px 8px', borderRadius: 999,
            background: role >= 2 ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.12)',
            color: role >= 2 ? '#4338ca' : '#047857',
          }}>{roleLabel}</div>
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          昵称 <span style={{ color: '#6366f1' }}>*</span>
        </label>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="如：小王"
          autoComplete="nickname"
          required
          style={{
            width: '100%', padding: '10px 12px', fontSize: 14,
            borderRadius: 10, border: '1px solid rgba(15,23,42,0.12)',
            background: 'rgba(255,255,255,0.8)', color: '#0f172a',
            boxSizing: 'border-box', outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
          onBlur={(e) => (e.target.style.borderColor = 'rgba(15,23,42,0.12)')}
        />
      </div>

      {showSchool && (
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
            学校 {isStudent && <span style={{ color: '#6366f1' }}>*</span>}
          </label>
          <input
            type="text"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder={isEditingOther ? '输入学生学校名称' : '如：南京市第一中学'}
            autoComplete="organization"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              borderRadius: 10, border: '1px solid rgba(15,23,42,0.12)',
              background: 'rgba(255,255,255,0.8)', color: '#0f172a',
              boxSizing: 'border-box', outline: 'none',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
            onBlur={(e) => (e.target.style.borderColor = 'rgba(15,23,42,0.12)')}
          />
          {isEditingOther && (
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0 0', lineHeight: 1.5 }}>
              修改学校后，该学生在列表中的分类也会更新。
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            flex: 1, padding: '10px 16px', fontSize: 14, fontWeight: 600,
            borderRadius: 10, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
            background: busy ? '#cbd5e1' : '#6366f1', color: 'white',
            opacity: busy ? 0.7 : 1, transition: 'background 0.15s',
          }}
        >
          {busy ? '保存中…' : '保存'}
        </button>
        {mode === 'modal' && (
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '10px 16px', fontSize: 14, fontWeight: 600,
              borderRadius: 10, cursor: busy ? 'not-allowed' : 'pointer',
              background: 'transparent', color: '#64748b',
              border: '1px solid rgba(15,23,42,0.12)',
            }}
          >
            取消
          </button>
        )}
      </div>

      {!isEditingOther && (
        <button
          type="button"
          onClick={() => { if (confirm('确定退出登录吗？')) { signOut(); onClose?.(); } }}
          style={{
            marginTop: 8, padding: '8px 12px', fontSize: 13,
            borderRadius: 8, cursor: 'pointer',
            background: 'transparent', color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.25)',
            alignSelf: 'flex-start',
          }}
        >
          退出登录
        </button>
      )}
    </form>
  );

  // ============ Modal mode ============
  if (mode === 'modal') {
    return (
      <AnimatePresence>
        <motion.div
          className="modal-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              width: '100%', maxWidth: 420,
              background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)',
              borderRadius: 18, padding: 24,
              boxShadow: '0 20px 60px rgba(15,23,42,0.25)',
              border: '1px solid rgba(255,255,255,0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {isEditingOther ? '编辑学生资料' : '我的资料'}
              </h2>
              <button
                onClick={onClose}
                style={{
                  width: 28, height: 28, borderRadius: 8, cursor: 'pointer',
                  background: 'rgba(15,23,42,0.04)', color: '#64748b',
                  border: 'none', fontSize: 16, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>
            {form}
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ============ Inline mode ============
  return (
    <div style={{
      background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(12px)',
      borderRadius: 16, padding: 24,
      border: '1px solid rgba(15,23,42,0.06)',
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      maxWidth: 480,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 16px 0' }}>
        {isEditingOther ? '编辑学生资料' : '我的资料'}
      </h2>
      {form}
    </div>
  );
}
