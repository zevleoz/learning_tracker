import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';

export default function Notifications() {
  const [user, setUser] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sub, setSub] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      setUser(u);
      await loadInvites();
      startRealtime(u.id);
    })();

    return () => {
      if (sub) sub.unsubscribe();
    };
  }, []);

  async function loadInvites() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: connData, error: connError } = await supabase
        .from('teacher_student_connections')
        .select('id, teacher_id, status, note, created_at, updated_at')
        .eq('student_id', user.id);
      
      if (connError) {
        console.error('Connection query error:', connError);
        toast(`加载邀请失败：${connError.message}`, { kind: 'error' });
        setLoading(false);
        return;
      }

      console.log('Connection data:', connData);

      const teacherIds = Array.from(new Set((connData || []).map((c) => c.teacher_id)));
      console.log('Teacher IDs:', teacherIds);

      let names = {};
      if (teacherIds.length > 0) {
        const { data: profData, error: profError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', teacherIds);
        
        if (profError) {
          console.error('Profiles query error:', profError);
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
      console.error('loadInvites error:', err);
      toast(err.message || '加载邀请失败', { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function startRealtime(studentId) {
    const subscription = supabase
      .channel('public:teacher_student_connections')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'teacher_student_connections',
        filter: `student_id=eq.${studentId}`,
      }, (payload) => {
        console.log('Invite realtime event:', payload);
        if (payload.eventType === 'INSERT' && payload.new.status === 0) {
          toast('收到新的老师邀请！', { kind: 'success' });
        }
        loadInvites();
      })
      .subscribe();
    setSub(subscription);
  }

  async function updateStatus(id, status) {
    const { error } = await supabase
      .from('teacher_student_connections')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return toast(error.message, { kind: 'error' });
    toast(status === 1 ? '已接受邀请，老师现在可以查看你的学习数据 🎉' : '已拒绝邀请', { kind: 'success' });
  }

  async function disconnect(id) {
    if (!confirm('确定要断开与这位老师的连接吗？断开后老师将无法继续查看你的学习数据。')) return;
    const { error } = await supabase
      .from('teacher_student_connections')
      .update({ status: 2, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return toast(error.message, { kind: 'error' });
    toast('已断开连接', { kind: 'success' });
  }

  const pending = invites.filter((i) => i.status === 0);
  const accepted = invites.filter((i) => i.status === 1);
  const rejected = invites.filter((i) => i.status === 2);

  return (
    <div style={{ padding: '16px 16px 120px', maxWidth: 760, margin: '0 auto', fontSize: 13, color: '#334155' }}>
      <header>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>邀请通知</h1>
        <p style={{ color: '#64748b', margin: 0 }}>
          当你的老师邀请你加入时，他们可以在接受后查看你的学习数据、Review、得分。
        </p>
      </header>

      {loading && <div style={{ marginTop: 20, color: '#94a3b8' }}>加载中…</div>}

      {!loading && pending.length === 0 && accepted.length === 0 && rejected.length === 0 && (
        <Card style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 14, marginBottom: 4 }}>还没有邀请。</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>老师邀请你后，你将在这里看到并选择接受/拒绝。</div>
        </Card>
      )}

      {pending.length > 0 && (
        <Section title="等待你的决定" count={pending.length} hint="接受后老师将能查看你的学习数据">
          {pending.map((c) => (
            <InviteRow
              key={c.id}
              invite={c}
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
                <button onClick={() => disconnect(c.id)} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 8,
                  border: '1px solid rgba(239,68,68,0.3)', color: '#b91c1c',
                  background: 'rgba(255,255,255,0.8)', cursor: 'pointer',
                }}>断开</button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {rejected.length > 0 && (
        <Section title="已拒绝" count={rejected.length} hint="老师可以再次发起邀请。">
          {rejected.map((c) => (
            <div key={c.id} style={{
              background: '#fff', border: '1px solid rgba(239,68,68,0.18)',
              padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontWeight: 500, color: '#334155' }}>{c.teacher_name}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  {c.status === 2 && c.updated_at ? `拒绝于 ${String(c.updated_at).slice(0, 10)}` : '已拒绝'}
                </div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                color: '#b91c1c', background: '#fecaca',
              }}>已拒绝</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.4)',
      borderRadius: 16, padding: 18, ...style,
    }}>
      {children}
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

function InviteRow({ invite, onAccept, onReject }) {
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
          <button onClick={onAccept} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 10, border: '1px solid #10b981', color: '#065f46', background: '#d1fae5', cursor: 'pointer', fontWeight: 600,
          }}>接受</button>
          <button onClick={onReject} style={{
            fontSize: 12, padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', color: '#b91c1c', background: 'rgba(255,255,255,0.9)', cursor: 'pointer', fontWeight: 500,
          }}>拒绝</button>
        </div>
      </div>
    </div>
  );
}