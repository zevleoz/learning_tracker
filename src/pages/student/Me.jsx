import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../lib/useAuth.js';
import { toast } from '../../lib/toast.js';
import { logger } from '../../lib/logger.js';
import {
  getPermission, isIOSNeedsInstall, isPushSupported, subscribe, unsubscribe,
} from '../../lib/push.js';
import ProfileEditor from '../../components/ProfileEditor.jsx';
import Notifications from '../Notifications.jsx';
import { Sheet } from '../../components/student/LogSheet.jsx';
import '../../styles/student-me.css';

/* ================================================================
   我的：资料 · 导师与邀请 · 我的课程 · 提醒 · 退出登录（深浅色跟随系统，不单设入口）
   提醒设置（/me/reminders）作为同文件的命名导出 Reminders。
   ================================================================ */

export default function Me() {
  const nav = useNavigate();
  const { signOut } = useAuth();
  const [me, setMe] = useState({ id: null, name: '', school: '', email: '' });
  const [courseCount, setCourseCount] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: p } = await supabase
          .from('profiles')
          .select('full_name, school_name')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        setMe({
          id: user.id,
          name: p?.full_name || user.user_metadata?.full_name || '',
          school: p?.school_name || '',
          email: user.email || '',
        });
        const { data: cs } = await supabase
          .from('courses')
          .select('id, created_by')
          .is('deleted_at', null);
        if (!cancelled && cs) setCourseCount(cs.filter((c) => c.created_by === user.id).length);
      } catch (err) {
        logger.error('Me load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  async function handleSignOut() {
    await signOut();
    nav('/login', { replace: true });
  }

  const initial = (me.name || '').trim().slice(0, 1) || '我';
  const pushState = getPermission();

  return (
    <div className="yb-lg mep-page">
      <header className="mep-profile">
        <span className="mep-avatar lg" aria-hidden="true">{initial}</span>
        <div className="mep-profile-t">
          <h1>{me.name || '未设置昵称'}</h1>
          <p>{[me.school, me.email].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        <button type="button" className="yb-btn ghost sm" onClick={() => setEditingProfile(true)}>编辑</button>
      </header>

      <Notifications />

      <section className="mep-block" aria-label="设置">
        <ul className="mep-list">
          <li>
            <Link to="/me/courses" className="mep-li">
              <span className="mep-li-t"><b>我的课程</b></span>
              <span className="mep-li-r">{courseCount == null ? '' : `${courseCount} 门`}</span>
              <ChevronRight size={16} aria-hidden="true" className="mep-chev" />
            </Link>
          </li>
          <li>
            <Link to="/me/reminders" className="mep-li">
              <span className="mep-li-t"><b>提醒</b></span>
              <span className="mep-li-r">{pushState === 'granted' ? '已开启' : '未开启'}</span>
              <ChevronRight size={16} aria-hidden="true" className="mep-chev" />
            </Link>
          </li>
        </ul>
      </section>

      <button type="button" className="mep-signout" onClick={() => setConfirmOut(true)}>退出登录</button>

      {editingProfile && (
        <ProfileEditor
          mode="modal"
          variant="student"
          onClose={() => setEditingProfile(false)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}

      <Sheet
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title="退出登录？"
        footer={(
          <>
            <button type="button" className="yb-btn ghost" onClick={() => setConfirmOut(false)}>取消</button>
            <button type="button" className="yb-btn" onClick={handleSignOut}>退出</button>
          </>
        )}
      >
        <p className="mep-note">退出后需要重新登录才能继续记录。</p>
      </Sheet>
    </div>
  );
}

/* ================================================================
   提醒设置（/me/reminders）
   - 授权只在打开第一个开关时请求，页面加载时不请求。
   - 偏好存 profiles.notification_prefs；列还不存在（补丁未执行）时降级为只读提示。
   ================================================================ */
export const DEFAULT_PREFS = {
  daily_reminder: false,
  daily_reminder_time: '21:00',
  pending_digest: true,
  streak_reminder: true,
  invites: true,
  weekly_email: false,
};

export const REMINDER_ROWS = [
  { key: 'daily_reminder', title: '每日提醒', desc: (p) => `${p.daily_reminder_time} · 只在当天还没记录时`, push: true, time: true },
  { key: 'pending_digest', title: '待补填', desc: () => '次日 18:00 · 汇总成一条', push: true },
  { key: 'streak_reminder', title: '连续记录快断了', desc: () => '20:30 · 休息日用完时', push: true },
  { key: 'invites', title: '导师邀请', desc: () => '立即', push: true },
  { key: 'weekly_email', title: '每周小结', desc: () => '周日 19:00 · 邮件', push: false },
];

export function normalizePrefs(raw) {
  const out = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULT_PREFS)) {
      if (typeof raw[k] === typeof DEFAULT_PREFS[k]) out[k] = raw[k];
    }
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out.daily_reminder_time)) out.daily_reminder_time = DEFAULT_PREFS.daily_reminder_time;
  return out;
}

// 列不存在：Postgres 42703，PostgREST 会报 "column ... does not exist"
function isMissingColumn(err) {
  if (!err) return false;
  return err.code === '42703' || err.code === 'PGRST204' || /notification_prefs|does not exist/i.test(err.message || '');
}

const DENIED_COPY = {
  denied: '通知权限被拒绝了。请在浏览器或系统设置里允许一表人才发送通知，再回来开启。',
  unsupported: '这个浏览器暂不支持推送提醒。',
  'needs-install': '请先把一表人才添加到主屏幕，再从主屏幕打开后开启。',
  'no-key': '推送服务还没有配置好，请稍后再试。',
  'save-failed': '这台设备没能保存订阅，请稍后再试。',
};

export function Reminders() {
  const [uid, setUid] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(true);     // notification_prefs 列是否存在
  const [permission, setPermission] = useState(() => getPermission());
  const [busyKey, setBusyKey] = useState(null);
  const [problem, setProblem] = useState('');
  const needsInstall = isIOSNeedsInstall();
  const supported = isPushSupported();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setUid(user.id);
        const { data, error } = await supabase
          .from('profiles')
          .select('notification_prefs')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          if (isMissingColumn(error)) setAvailable(false);
          else logger.error('load notification_prefs failed:', error);
        } else {
          setPrefs(normalizePrefs(data?.notification_prefs));
        }
      } catch (err) {
        logger.error('Reminders load failed:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const granted = permission === 'granted';
  // 推送类开关：没有授权时一律显示为关（服务端没有订阅就发不出去）；周报邮件不依赖授权
  const isOn = (row) => (row.push ? granted && prefs[row.key] : prefs[row.key]);
  const blocked = needsInstall || permission === 'denied' || (!supported && !needsInstall);

  async function persist(next) {
    const { error } = await supabase
      .from('profiles')
      .update({ notification_prefs: next })
      .eq('id', uid);
    if (error) {
      if (isMissingColumn(error)) setAvailable(false);
      else logger.error('save notification_prefs failed:', error);
      return false;
    }
    return true;
  }

  async function toggle(row) {
    if (!uid || busyKey || !available) return;
    const turningOn = !isOn(row);
    setBusyKey(row.key);
    setProblem('');
    try {
      // 第一次打开推送类开关时才请求授权并订阅
      if (turningOn && row.push && !granted) {
        const res = await subscribe(uid);
        setPermission(getPermission());
        if (!res.ok) {
          setProblem(DENIED_COPY[res.reason] || '没能开启提醒，请稍后再试。');
          return;
        }
      }
      const next = { ...prefs, [row.key]: turningOn };
      const ok = await persist(next);
      if (!ok) {
        toast('保存失败，请稍后再试', { kind: 'error' });
        return;
      }
      setPrefs(next);
      // 推送类开关全部关掉后，取消这台设备的订阅
      const anyPush = REMINDER_ROWS.some((r) => r.push && next[r.key]);
      if (row.push && !turningOn && !anyPush) await unsubscribe();
    } catch (err) {
      logger.error('toggle reminder failed:', err);
      toast('保存失败，请稍后再试', { kind: 'error' });
    } finally {
      setBusyKey(null);
    }
  }

  async function changeTime(value) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || !available || !uid) return;
    const prev = prefs;
    const next = { ...prefs, daily_reminder_time: value };
    setPrefs(next);
    const ok = await persist(next);
    if (!ok) {
      setPrefs(prev);
      toast('保存失败，请稍后再试', { kind: 'error' });
    }
  }

  return (
    <div className="yb-lg mep-page">
      <header className="mep-sub">
        <Link to="/me" className="mep-back">我的</Link>
        <h1>提醒</h1>
      </header>

      {needsInstall && (
        <section className="mep-card warm" aria-label="添加到主屏幕">
          <b>iPhone 需要先添加到主屏幕</b>
          <p className="mep-note">在 Safari 标签页里收不到提醒。添加后从主屏幕打开一表人才，再回到这里开启。</p>
          <ol className="mep-steps">
            <li>点 Safari 底部的 <b>分享</b></li>
            <li>选 <b>添加到主屏幕</b></li>
            <li>从主屏幕图标打开</li>
          </ol>
        </section>
      )}

      {!needsInstall && permission === 'denied' && (
        <p className="mep-note warn">{DENIED_COPY.denied}</p>
      )}
      {!needsInstall && !supported && permission !== 'denied' && (
        <p className="mep-note">{DENIED_COPY.unsupported}</p>
      )}
      {loaded && !available && (
        <p className="mep-note">提醒设置还在准备中，暂时无法修改。</p>
      )}
      {problem && <p className="mep-note warn" role="alert">{problem}</p>}

      <section className="mep-block" aria-label="提醒类型">
        <ul className="mep-list">
          {REMINDER_ROWS.map((row) => {
            const on = isOn(row);
            const disabled = !loaded || !available || busyKey === row.key || (row.push && blocked && !on);
            return (
              <li key={row.key} className="mep-li static">
                <span className="mep-li-t">
                  <b id={`rem-${row.key}`}>{row.title}</b>
                  <span>{row.desc(prefs)}</span>
                  {row.time && on && (
                    <label className="mep-time">
                      提醒时间
                      <input
                        type="time"
                        className="yb-input"
                        value={prefs.daily_reminder_time}
                        onChange={(e) => changeTime(e.target.value)}
                        aria-label="每日提醒时间"
                      />
                    </label>
                  )}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={`rem-${row.key}`}
                  className={'mep-switch' + (on ? ' on' : '')}
                  disabled={disabled}
                  onClick={() => toggle(row)}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mep-note mep-center">每天最多一条提醒（导师邀请除外），22:30–07:00 不打扰。</p>
    </div>
  );
}
