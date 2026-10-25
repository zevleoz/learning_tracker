import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { toast } from '../lib/toast.js';
import { logger } from '../lib/logger.js';
import { Sheet } from '../components/student/LogSheet.jsx';

/* ================================================================
   导师与邀请（在「我的」页内渲染；/notifications 已重定向到 /me）。

   同意页的每一行都对照数据库实际允许的范围：
   - 能看：is_connected_teacher_of(student_id)（status = 1 且对方是导师）才能 SELECT
       learning_sessions（时间、课程、类别、形式、备注、主观评价、客观评价）、exam_scores；
       没有时间下限，所以包含接受之前的全部历史记录。
       profiles 对所有导师可读（profiles_select_self_or_mentor）。
   - 能改：只有 update_student_name / update_student_school 两个 RPC，要求已连接。
   - 不能：learning_sessions 的 INSERT/UPDATE 策略都是 student_id = auth.uid()，
       没有 DELETE 策略；exam_scores 同理。
   - 接受前：status = 0 时 is_connected_teacher_of 为 false，看不到任何记录。
   - 断开：学生可把 status 更新为 2（tsc_update_student），断开后立即失效。
   改 RLS 时必须同步修改这里的文案。
   ================================================================ */
export const MENTOR_ACCESS = {
  can: [
    '你的学习记录：时间、课程、类别、形式和备注，包括接受之前的全部记录',
    '你的主观评价和客观评价',
    '你的考试成绩',
    '你的姓名和学校',
  ],
  mayDo: ['更正你的姓名和学校（用于归类）'],
  cannot: [
    '不能修改或删除你的任何学习记录和考试成绩',
    '接受之前，看不到你的任何记录',
  ],
};

// created_at 是 timestamptz（UTC）：用本地时区取月日，避免 UTC+8 早 8 点前偏一天
function monthDay(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// 把 Supabase 错误转换成用户友好的中文提示，避免直接暴露技术细节
function friendlyError(err, fallback = '操作失败，请稍后再试') {
  if (!err) return fallback;
  const msg = err.message || '';
  const code = err.code;
  // 42501 = insufficient_privilege / RLS 拒绝
  if (code === '42501' || /permission denied|policy/i.test(msg)) return '权限不足：您只能操作自己的数据';
  if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连接异常，请检查网络';
  if (/timeout|abort/i.test(msg)) return '请求超时，请稍后重试';
  return fallback;
}

function Avatar({ name, muted }) {
  const ch = (name || '').trim().slice(0, 1) || '师';
  return <span className={'mep-avatar' + (muted ? ' muted' : '')} aria-hidden="true">{ch}</span>;
}

/** 同意页 / 导师详情共用的「能看 / 不能」清单。 */
function AccessList({ withMayDo = true }) {
  return (
    <div className="mep-access">
      <ul className="mep-perm" aria-label="可以看到">
        {MENTOR_ACCESS.can.map((t) => (<li key={t} className="yes">{t}</li>))}
      </ul>
      {withMayDo && (
        <ul className="mep-perm" aria-label="还可以">
          {MENTOR_ACCESS.mayDo.map((t) => (<li key={t} className="yes">{t}</li>))}
        </ul>
      )}
      <ul className="mep-perm" aria-label="不能">
        {MENTOR_ACCESS.cannot.map((t) => (<li key={t} className="no">{t}</li>))}
      </ul>
    </div>
  );
}

export default function Notifications({ onPendingChange }) {
  const [user, setUser] = useState(null);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);          // 当前打开的 sheet 对应的连接
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // 用 ref 保存 subscription，确保卸载时能正确清理（不能用 state，否则 cleanup 闭包里读到的是 null）
  const subRef = useRef(null);
  const onPendingRef = useRef(onPendingChange);
  onPendingRef.current = onPendingChange;

  const loadInvites = useCallback(async (studentId) => {
    if (!studentId) return;
    try {
      const { data: connData, error: connError } = await supabase
        .from('teacher_student_connections')
        .select('id, teacher_id, status, note, created_at, updated_at')
        .eq('student_id', studentId);

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

      setInvites((connData || []).map((c) => ({
        ...c,
        teacher_name: names[c.teacher_id] || '未命名老师',
      })));
    } catch (err) {
      logger.error('loadInvites error:', err);
      toast(friendlyError(err, '加载邀请失败，请稍后重试'), { kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u || cancelled) { setLoading(false); return; }
      setUser(u);
      await loadInvites(u.id);
      if (cancelled) return;

      // 在 effect 内创建 subscription，cleanup 时通过同一引用卸载
      const subscription = supabase
        .channel('public:teacher_student_connections')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'teacher_student_connections',
          filter: `student_id=eq.${u.id}`,
        }, (payload) => {
          if (cancelled) return; // 卸载后不再触发刷新
          if (payload.eventType === 'INSERT' && payload.new?.status === 0) {
            toast('收到新的老师邀请', { kind: 'success' });
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
  }, [loadInvites]);

  const pending = invites.filter((i) => i.status === 0);
  const accepted = invites.filter((i) => i.status === 1);
  const open = openId ? invites.find((c) => c.id === openId) : null;

  useEffect(() => { onPendingRef.current?.(pending.length); }, [pending.length]);

  function closeSheet() {
    setOpenId(null);
    setConfirmDisconnect(false);
  }

  async function setStatus(id, status, { okMsg, failMsg }) {
    if (!user || busyId) return;
    setBusyId(id);
    try {
      const { error } = await supabase
        .from('teacher_student_connections')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('student_id', user.id);
      if (error) {
        logger.error('connection status update error:', error);
        toast(friendlyError(error, failMsg), { kind: 'error' });
        return;
      }
      // 乐观更新本地状态，避免完全依赖 realtime 回流
      setInvites((prev) => prev.map((c) => (c.id === id ? { ...c, status, updated_at: new Date().toISOString() } : c)));
      toast(okMsg, { kind: 'success' });
      closeSheet();
    } finally {
      setBusyId(null);
    }
  }

  const accept = (id) => setStatus(id, 1, { okMsg: '已接受，老师现在可以查看你的学习数据', failMsg: '操作失败，请稍后重试' });
  const decline = (id) => setStatus(id, 2, { okMsg: '已拒绝邀请', failMsg: '操作失败，请稍后重试' });
  const disconnect = (id) => setStatus(id, 2, { okMsg: '已断开连接', failMsg: '断开失败，请稍后重试' });

  const busy = Boolean(open && busyId === open.id);

  return (
    <section className="mep-block" aria-labelledby="mep-mentors-h">
      <h2 id="mep-mentors-h" className="mep-h2">导师</h2>

      {loading && <p className="mep-note" role="status">加载中…</p>}

      {pending.map((c) => (
        <button
          key={c.id}
          type="button"
          className="mep-invite"
          aria-haspopup="dialog"
          onClick={() => { setConfirmDisconnect(false); setOpenId(c.id); }}
        >
          <span className="mep-invite-t">
            <b>{c.teacher_name}邀请你连接</b>
            <span className="mep-status"><i className="mep-dot brass" aria-hidden="true" />{monthDay(c.created_at)} · 等你决定</span>
          </span>
          <span className="mep-pill">查看</span>
        </button>
      ))}

      {accepted.length > 0 && (
        <ul className="mep-list">
          {accepted.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="mep-li"
                aria-haspopup="dialog"
                onClick={() => { setConfirmDisconnect(false); setOpenId(c.id); }}
              >
                <Avatar name={c.teacher_name} muted />
                <span className="mep-li-t">
                  <b>{c.teacher_name}</b>
                  <span className="mep-status"><i className="mep-dot good" aria-hidden="true" />已连接 · {monthDay(c.updated_at || c.created_at)}起可查看你的学习数据</span>
                </span>
                <ChevronRight size={16} aria-hidden="true" className="mep-chev" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && pending.length === 0 && accepted.length === 0 && (
        <p className="mep-note">还没有导师。老师邀请你之后，会在这里等你决定。</p>
      )}

      <Sheet
        open={Boolean(open)}
        onClose={closeSheet}
        title={open?.status === 0 ? `${open?.teacher_name || ''}想查看你的学习数据` : (open?.teacher_name || '导师')}
        footer={open && (open.status === 0 ? (
          <>
            <button type="button" className="yb-btn ghost" disabled={busy} onClick={() => decline(open.id)}>拒绝</button>
            <button type="button" className="yb-btn" disabled={busy} onClick={() => accept(open.id)}>
              {busy ? '处理中…' : '接受'}
            </button>
          </>
        ) : confirmDisconnect ? (
          <>
            <button type="button" className="yb-btn ghost" disabled={busy} onClick={() => setConfirmDisconnect(false)}>取消</button>
            <button type="button" className="yb-btn" disabled={busy} onClick={() => disconnect(open.id)}>
              {busy ? '处理中…' : '确认断开'}
            </button>
          </>
        ) : (
          <button type="button" className="yb-btn ghost" onClick={() => setConfirmDisconnect(true)}>断开连接</button>
        ))}
      >
        {open && open.status === 0 && (
          <>
            <p className="mep-note">
              {open.teacher_name}（导师）· {monthDay(open.created_at)}发出
            </p>
            {open.note && <p className="mep-quote">“{open.note}”</p>}
            <div className="mep-card">
              <div className="mep-eyebrow">接受后，{open.teacher_name}可以看到</div>
              <AccessList />
            </div>
            <p className="mep-note mep-center">随时可以在「我的」里断开连接。</p>
          </>
        )}
        {open && open.status === 1 && (
          <>
            <p className="mep-note">
              {monthDay(open.updated_at || open.created_at)}连接，现在可以看到：
            </p>
            <div className="mep-card"><AccessList /></div>
            {confirmDisconnect && (
              <p className="mep-note warn">
                断开后，{open.teacher_name}将立即无法再查看你的学习数据。之后需要重新被邀请才能再次连接。
              </p>
            )}
          </>
        )}
      </Sheet>
    </section>
  );
}
