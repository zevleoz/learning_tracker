import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';

// 把 Supabase 错误转换成用户友好的中文提示，避免直接暴露技术细节
function friendlyError(err, fallback = '操作失败，请稍后再试') {
  if (!err) return fallback;
  const msg = err.message || '';
  const code = err.code;
  // 42501 = insufficient_privilege / RLS 拒绝
  if (code === '42501' || /permission denied|policy/i.test(msg)) return '权限不足：您只能操作自己的数据';
  // 网络类
  if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连接异常，请检查网络';
  if (/timeout|abort/i.test(msg)) return '请求超时，请稍后重试';
  return fallback;
}

/* Spinner：inline loading indicator，用于按钮 busy 态 */
function Spinner({ size = 12, color = 'currentColor' }) {
  return (
    <motion.svg
      width={size} height={size} viewBox="0 0 50 50"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <circle cx="25" cy="25" r="20" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="5" />
      <path d="M25 5 a20 20 0 0 1 20 20" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
    </motion.svg>
  );
}

export default function Notifications() {
  const [user, setUser] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [initialLoaded, setInitialLoaded] = useState(false);
  // 用 ref 保存 subscription，确保卸载时能正确清理（不能用 state，否则 cleanup 闭包里读到的是 null）
  const subRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u || cancelled) return;
      setUser(u);
      await loadInvites(u.id);
      setInitialLoaded(true);

      // 在 effect 内创建 subscription，cleanup 时通过同一引用卸载
      const subscription = supabase
        .channel('public:teacher_student_connections')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'teacher_student_connections',
          filter: `student_id=eq.${u.id}`,
        }, (payload) => {
          if (payload.eventType === 'INSERT' && payload.new?.status === 0) {
            toast('收到新的老师邀请！', { kind: 'success' });
          }
          loadInvites(u.id);
        })
        .subscribe();
      subRef.current = subscription;
    })();

    return () => {
      cancelled = true;
      if (subRef.current) {
        subRef.current.unsubscribe();
        subRef.current = null;
      }
    };
  }, []);

  async function loadInvites(studentId) {
    if (!studentId && !user) return;
    const id = studentId || user.id;
    setLoading(true);
    try {
      const { data: connData, error: connError } = await supabase
        .from('teacher_student_connections')
        .select('id, teacher_id, status, note, created_at, updated_at')
        .eq('student_id', id);

      if (connError) {
        logger.error('Connection query error:', connError);
        toast(friendlyError(connError, '加载邀请失败，请稍后重试'), { kind: 'error' });
        return;
      }

      const teacherIds = Array.from(new Set((connData || []).map((c) => c.teacher_id)));

      let names = {};
      if (teacherIds.length > 0) {
        const { data: profData, error: profError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', teacherIds);

        if (profError) {
          logger.error('Profiles query error:', profError);
          toast('无法获取老师信息', { kind: 'warning' });
        } else {
          names = Object.fromEntries((profData || []).map((p) => [p.id, p.full_name]));
        }
      }

      const decorated = (connData || []).map((c) => ({
        ...c,
        teacher_name: names[c.teacher_id] || '(未命名老师)',
      }));
      setInvites(decorated);
    } catch (err) {
      logger.error('loadInvites error:', err);
      toast(friendlyError(err, '加载邀请失败，请稍后重试'), { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id, status) {
    if (!user) return;
    if (busyId) return;
    setBusyId(id);
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('student_id', user.id);
      if (error) {
        logger.error('updateStatus error:', error);
        toast(friendlyError(error, '操作失败，请稍后重试'), { kind: 'error' });
        return;
      }
      // 乐观更新本地状态，避免完全依赖 realtime 回流
      setInvites((prev) => prev.map((c) => c.id === id ? { ...c, status } : c));
      toast(status === 1 ? '已接受邀请，老师现在可以查看你的学习数据' : '已拒绝邀请', { kind: 'success' });
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(id) {
    if (!user) return;
    if (busyId) return;
    setBusyId(id);
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .update({ status: 2, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('student_id', user.id);
      if (error) {
        logger.error('disconnect error:', error);
        toast(friendlyError(error, '断开失败，请稍后重试'), { kind: 'error' });
        return;
      }
      setInvites((prev) => prev.map((c) => c.id === id ? { ...c, status: 2 } : c));
      toast('已断开连接', { kind: 'success' });
    } finally {
      setBusyId(null);
    }
  }

  const pending = invites.filter((i) => i.status === 0);
  const accepted = invites.filter((i) => i.status === 1);

  // 确认弹窗的目标对象
  const confirmInvite = confirmTarget ? invites.find((c) => c.id === confirmTarget) : null;

  return (
    <div style={{ padding: '16px 16px 120px', maxWidth: 760, margin: '0 auto', fontSize: 13, color: '#334155' }}>
      <header>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>邀请通知</h1>
        <p style={{ color: '#64748b', margin: 0 }}>
          当你的老师邀请你加入时，他们可以在接受后查看你的学习数据、Review、得分。
        </p>
      </header>

      {loading && !initialLoaded && (
        <div className="loading-state" style={{ padding: '60px 16px' }}>
          <div className="loading-spinner"></div>
          <span>加载中…</span>
        </div>
      )}

      {!loading && initialLoaded && pending.length === 0 && accepted.length === 0 && (
        <div className="empty-state" style={{ marginTop: 16 }}>
          <div className="empty-state-icon"></div>
          <h3>还没有邀请</h3>
          <p>老师邀请你后，你将在这里看到并选择接受或拒绝。</p>
        </div>
      )}

      {initialLoaded && pending.length > 0 && (
        <Section title="等待你的决定" count={pending.length} hint="接受后老师将能查看你的学习数据">
          {pending.map((c) => (
            <InviteRow
              key={c.id}
              invite={c}
              busy={busyId === c.id}
              onAccept={() => updateStatus(c.id, 1)}
              onReject={() => updateStatus(c.id, 2)}
            />
          ))}
        </Section>
      )}

      {accepted.length > 0 && (
        <Section title="已连接（正在查看你）" count={accepted.length} hint="以下老师可以查看你的学习数据。">
          {accepted.map((c) => (
            <div key={c.id} style={{
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
              padding: '12px 14px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.teacher_name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  从 {String(c.created_at || '').slice(0, 10)} 起可以查看你的学习数据
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                  color: '#059669', background: '#a7f3d0',
                }}>已连接</span>
                <button
                  onClick={() => setConfirmTarget(c.id)}
                  disabled={busyId === c.id}
                  className="btn btn-ghost btn-sm"
                  style={{ color: '#b91c1c', borderColor: 'rgba(239,68,68,0.3)' }}
                >断开</button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {confirmTarget && confirmInvite && createPortal(
        <ConfirmDialog
          title="断开连接？"
          message={`确定要断开与 ${confirmInvite.teacher_name} 的连接吗？断开后老师将无法继续查看你的学习数据。`}
          busy={busyId === confirmInvite.id}
          confirmLabel="断开"
          confirmVariant="danger"
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            disconnect(confirmInvite.id).then(() => setConfirmTarget(null));
          }}
        />,
        document.body
      )}
    </div>
  );
}

function Section({ title, count, hint, children }) {
  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>{title}</h2>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{count}</span>
      </div>
      {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{hint}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}

function InviteRow({ invite, onAccept, onReject, busy }) {
  return (
    <div style={{
      background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
      padding: '12px 14px', borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{invite.teacher_name}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
            邀请时间：{String(invite.created_at || '').slice(0, 10)}
          </div>
          {invite.note && (
            <div style={{ fontSize: 12, color: '#475569', marginTop: 6, padding: '6px 10px', background: 'rgba(255,255,255,0.6)', borderRadius: 8 }}>
              "{invite.note}"
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onAccept}
            disabled={busy}
            className="btn btn-primary btn-sm"
            style={{ borderColor: '#10b981', color: '#065f46', background: '#d1fae5', minWidth: 64 }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {busy && <Spinner size={11} color="#065f46" />}
              {busy ? '处理中…' : '接受'}
            </span>
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="btn btn-ghost btn-sm"
            style={{ color: '#b91c1c', borderColor: 'rgba(239,68,68,0.4)', minWidth: 64 }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {busy && <Spinner size={11} color="#b91c1c" />}
              {busy ? '处理中…' : '拒绝'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel, busy, confirmLabel = '确认', confirmVariant = 'primary' }) {
  const isDanger = confirmVariant === 'danger';
  const confirmStyle = isDanger
    ? { background: 'rgba(239,68,68,0.12)', color: '#b91c1c', borderColor: 'rgba(239,68,68,0.3)' }
    : {};
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'fadeIn 180ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--glass-strong, rgba(255,255,255,0.9))',
          backdropFilter: 'var(--blur-sheet, blur(20px))',
          WebkitBackdropFilter: 'var(--blur-sheet, blur(20px))',
          borderRadius: 20, padding: 24,
          width: '100%', maxWidth: 340,
          border: '1px solid var(--edge-bright, rgba(15,23,42,0.08))',
          boxShadow: '0 2px 6px rgba(15,23,42,0.04), 0 18px 44px rgba(15,23,42,0.12)',
          animation: 'authModalIn 220ms cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700, color: 'var(--text-strong, #0f172a)' }}>{title}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-soft, #64748b)', lineHeight: 1.55 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >取消</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="btn btn-primary btn-sm"
            style={confirmStyle}
          >{busy ? '处理中…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
