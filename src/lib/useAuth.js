import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';
import { clearAllCaches } from './studentCache.js';

// 登录态是整个应用共用的一份（模块级 store）：
// 以前每个调用 useAuth() 的组件都各自 getSession + 查一次 profiles（一次冷启动 3–4 次重复请求，
// 而且每个组件要等自己那份跑完才能开始取数）；现在 getSession 与 profile 只取一次，所有组件共享。

const ROLE_HINT_KEY = 'yb:role-hint';
// profile 刚取过的话，认证事件（TOKEN_REFRESHED / 切回前台的 SIGNED_IN）不必立刻再查一遍
const PROFILE_FRESH_MS = 60 * 1000;

let state = { user: null, profile: null, loading: true, profileError: false };
// 还不知道角色时多试几次；已确认过角色时只试一次（后台刷新失败不该影响界面）
const PROFILE_RETRY_DELAYS_MS = [1000, 3000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
      // 已确认过角色时只试一次（后台刷新，失败不影响界面）；还不知道角色时重试几次
      const delays = state.profile ? [] : PROFILE_RETRY_DELAYS_MS;
      let lastErr = null;
      for (let i = 0; i <= delays.length; i++) {
        if (i > 0) await wait(delays[i - 1]);
        if (!stillCurrent()) return;
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('id, role, full_name, default_workspace, created_at')
            .eq('id', uid)
            .maybeSingle();
          if (error) throw error;
          if (!stillCurrent()) return;
          lastErr = null;
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
            setState({ profile: { ...data, role: data.role }, profileError: false });
            return;
          }
        } catch (err) {
          if (!stillCurrent()) return;
          lastErr = err;
        }
      }
      // 读不到权威角色：已知角色保持不变，绝不降级成学生
      if (state.profile) {
        logger.warn('profile refresh failed, keeping confirmed role', lastErr);
        return;
      }
      // 查到「没有这一行」只可能是刚注册（trigger 延迟）；本机记录是导师时不当学生处理
      if (!lastErr && !(readRoleHint(uid) >= 2)) {
        setState({ profile: { id: uid, role: 1, full_name: 'User' } });
        return;
      }
      logger.warn('loadProfile failed, role unknown', lastErr);
      setState({ profileError: true });
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
    setState({ user: null, profile: null, loading: false, profileError: false });
    return;
  }
  const sameUser = prevId === u.id;
  // user_metadata.role 只用于「和数据库不一致」的告警，绝不当作角色本身
  const metaRole = u.user_metadata?.role;
  const patch = { user: u };
  if (!sameUser) {
    // 换人：先清空，等权威 profile；同一用户绝不能回到 loading（会卸载进行中的 E4 表单）
    patch.profile = null;
    patch.loading = true;
    patch.profileError = false;
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

/**
 * 自己改完资料后把新值写进共享的 profile（今天的问候语、顶栏名字都读它）。
 * 改名触发的 USER_UPDATED 事件在 profile 刚取过（60 秒内）时会被跳过，不补这一步名字就停在旧值。
 * 只接受显示用字段，角色等权限字段一律以数据库为准。
 */
export function patchProfile(uid, { full_name: fullName } = {}) {
  if (!state.profile || state.profile.id !== uid || typeof fullName !== 'string') return;
  setState({ profile: { ...state.profile, full_name: fullName } });
}

// 角色读取失败后的手动重试（RoleLoadError 用）
export function retryProfile() {
  const u = state.user;
  if (!u) return;
  setState({ loading: true, profileError: false });
  loadProfile(u.id, u.user_metadata?.role);
}

export function useAuth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    user: s.user,
    profile: s.profile,
    loading: s.loading,
    profileError: s.profileError,
    signOut,
    isMentor: (s.profile?.role || 1) >= 2,
  };
}
