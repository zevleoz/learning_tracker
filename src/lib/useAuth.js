import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';
import { toast } from './toast.js';
import { clearAllCaches } from './studentCache.js';

// 登录态是整个应用共用的一份（模块级 store）：
// 以前每个调用 useAuth() 的组件都各自 getSession + 查一次 profiles（一次冷启动 3–4 次重复请求，
// 而且每个组件要等自己那份跑完才能开始取数）；现在 getSession 与 profile 只取一次，所有组件共享。

const ROLE_HINT_KEY = 'yb:role-hint';
// profile 刚取过的话，认证事件（TOKEN_REFRESHED / 切回前台的 SIGNED_IN）不必立刻再查一遍
const PROFILE_FRESH_MS = 60 * 1000;

let state = { user: null, profile: null, loading: true };
const listeners = new Set();
let started = false;
let profileInflight = null;     // { uid, promise }
let profileLoadedAt = { uid: null, at: 0 };

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

/**
 * 上次登录的角色提示（仅用于「冷启动先去哪个页面」，不参与任何权限判断；权限一律看 profiles 表）。
 * 学生冷启动据此直接进「今天」，不必等 profile 查完。
 */
export function readRoleHint(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(ROLE_HINT_KEY) || 'null');
    if (raw && raw.id === uid && Number.isFinite(Number(raw.role))) return Number(raw.role);
  } catch { /* 隐私模式 / 数据损坏：当作没有 */ }
  return null;
}
function writeRoleHint(uid, role) {
  try { localStorage.setItem(ROLE_HINT_KEY, JSON.stringify({ id: uid, role })); } catch { /* 忽略 */ }
}
function clearRoleHint() {
  try { localStorage.removeItem(ROLE_HINT_KEY); } catch { /* 忽略 */ }
}

async function loadProfile(uid, metaRole) {
  if (profileInflight && profileInflight.uid === uid) return profileInflight.promise;
  const promise = (async () => {
    const stillCurrent = () => state.user?.id === uid;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, full_name, default_workspace, created_at')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      if (!stillCurrent()) return;
      if (data) {
        // 安全原则：始终信任 profiles 表的 role（数据库权威来源），
        // 不信任 user_metadata.role（用户可自行修改 → 提权风险）
        if (metaRole && Number(metaRole) !== data.role) {
          logger.warn('Role mismatch: DB role takes precedence over user_metadata', {
            user_metadata_role: metaRole,
            profiles_role: data.role,
          });
        }
        profileLoadedAt = { uid, at: Date.now() };
        writeRoleHint(uid, Number(data.role) || 1);
        setState({ profile: { ...data, role: data.role } });
        return;
      }
      // profile 行尚未创建（trigger 延迟）：按学生处理，不用 metadata 判定导师身份
      setState({ profile: { id: uid, role: 1, full_name: 'User' } });
    } catch (err) {
      if (!stillCurrent()) return;
      // fail-closed：读不到权威角色时一律按学生处理，
      // 否则 user_metadata 被篡改即可让界面进入导师工作区
      logger.warn('loadProfile failed, falling back to student role:', err);
      setState({ profile: { id: uid, role: 1, full_name: 'User' } });
      toast('账号信息读取失败，已按学生视图显示；请检查网络后刷新重试', { kind: 'error' });
    } finally {
      if (stillCurrent()) setState({ loading: false });
    }
  })();
  profileInflight = { uid, promise };
  promise.finally(() => { if (profileInflight && profileInflight.promise === promise) profileInflight = null; });
  return promise;
}

// 从 session / auth state 同步 user + profile
function sync(session, { fromEvent = false } = {}) {
  const u = session?.user || null;
  const prevId = state.user?.id || null;
  if (prevId !== (u?.id || null)) {
    // 换人 / 退出：上一个人的缓存一律作废
    if (prevId) clearAllCaches(prevId);
    if (!u) clearRoleHint();
  }
  if (!u) {
    setState({ user: null, profile: null, loading: false });
    return;
  }
  const sameUser = prevId === u.id;
  // 先从 user_metadata 读 role/full_name（signUp 时传入的），然后异步查 profile 表做补充
  const metaRole = u.user_metadata?.role;
  const metaName = u.user_metadata?.full_name || u.email;
  const patch = { user: u };
  if (!sameUser) {
    patch.profile = metaRole ? { id: u.id, role: Number(metaRole), full_name: metaName } : null;
  }
  setState(patch);
  const fresh = sameUser && profileLoadedAt.uid === u.id && Date.now() - profileLoadedAt.at < PROFILE_FRESH_MS;
  if (fromEvent && fresh) return;
  loadProfile(u.id, metaRole);
}

function start() {
  if (started) return;
  started = true;
  supabase.auth.getSession().then(({ data: { session } }) => sync(session));
  // 监听变更（整个应用生命周期只订阅一次）
  supabase.auth.onAuthStateChange((_evt, session) => sync(session, { fromEvent: true }));
}

function subscribe(fn) {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const getSnapshot = () => state;

const signOut = async () => {
  const uid = state.user?.id;
  try {
    return await supabase.auth.signOut();
  } finally {
    // 不等认证事件：退出的瞬间就清掉这个人的缓存
    if (uid) clearAllCaches(uid);
  }
};

export function useAuth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { user: s.user, profile: s.profile, loading: s.loading, signOut, isMentor: (s.profile?.role || 1) >= 2 };
}
