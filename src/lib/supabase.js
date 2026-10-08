import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Supabase configuration missing. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.');
}

// Vercel 部署提醒：如果使用的是默认 localhost 地址，提示用户在 Vercel 配置环境变量
if (import.meta.env.DEV && SUPABASE_URL.includes('localhost')) {
  console.warn('%c[DEPLOY WARNING]%c 检测到本地 Supabase 配置。', 'color:orange; font-weight:bold;', '');
  console.warn('  部署到 Vercel 前，请在 Project Settings -> Environment Variables 中配置：');
  console.warn('    - VITE_SUPABASE_URL');
  console.warn('    - VITE_SUPABASE_ANON_KEY');
}
if (import.meta.env.PROD && SUPABASE_URL.includes('localhost')) {
  console.error('%c[DEPLOY ERROR]%c 生产环境仍在使用 localhost Supabase 配置！', 'color:red; font-weight:bold;', '');
  console.error('  请立即在 Vercel Project Settings 中配置正确的环境变量。');
}

// 临时禁用 BroadcastChannel，阻止 Supabase 跨标签页同步 session。
// 否则两个标签页共享同一 storageKey 时，一个标签页登录会广播覆盖另一个。
const _BroadcastChannel = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // 每个标签页独立 session：admin 标签页与学生标签页互不覆盖。
    // sessionStorage 在标签页存活期间保留（含刷新），关闭标签页即销毁。
    // 不读 localStorage，避免跨标签页 session 泄漏。
    storageKey: 'mentor-app-auth',
    storage: {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    },
  },
  schema: 'public',
  global: {
    fetch: (url, options = {}) => {
      // 默认 10s 超时；数据重的查询可用 query.abortSignal(timeoutSignal(30000)) 显式放宽（STU-3）
      const signal = options.signal || AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
      return fetch(url, {
        ...options,
        signal
      });
    }
  }
});

// 查询超时：默认值 + 给重查询的放宽通道
export const DEFAULT_TIMEOUT_MS = 10000;

/**
 * 放宽单条查询的超时（用于导师看板聚合、E4 待办全量拉取等慢查询）。
 * 用法：supabase.from('x').select('*').abortSignal(timeoutSignal(30000))
 */
export function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
}

// 恢复 BroadcastChannel，避免影响应用其他可能用到它的逻辑。
// Supabase 客户端已在上方创建完毕，此后不再使用它做 session 同步。
globalThis.BroadcastChannel = _BroadcastChannel;

// 服务端代理（/api/y4、/api/llm）需要校验调用者身份：
// 从本地 session 取 access_token 注入 Authorization 头（只读本地缓存，不发网络请求）。
export async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  } catch {
    return '';
  }
}

export async function safeQuery(promise, errorMsg = '操作失败') {
  try {
    const result = await promise;
    if (result.error) {
      throw new Error(result.error.message || errorMsg);
    }
    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    }
    if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
      throw new Error('网络连接异常，请检查网络');
    }
    throw err;
  }
}

export const SOURCE_LABEL = { 1: '校内课程', 2: '外部考试', 3: '语言学习', 4: '自学' };
export const SOURCE_ICON  = { 1: '🏫', 2: '📜', 3: '🗣', 4: '📖' };

export const CATEGORY_LABEL = { 1: '学习', 2: '复习', 3: '练习' };
export const CATEGORY_COLOR = { 1: 'text-sky-300', 2: 'text-violet-300', 3: 'text-emerald-300' };

export const FORM_LABEL = {
  1: '学校课堂', 2: '自主预习', 3: '自主复习', 4: '自主练习',
  5: '校外线上', 6: '校外线下', 7: '学校作业',
  8: '课堂练习(不算分)', 9: '课堂练习(算分)'
};

export const SIGNAL_LABEL = { 1: 'Hesitant', 2: 'Slow', 3: 'Growth', 4: 'Stable' };
export const SIGNAL_CARD  = { 1: 'signal-card-hesitant', 2: 'signal-card-slow', 3: 'signal-card-growth', 4: 'signal-card' };
export const SIGNAL_DOT   = { 1: 'dot dot-hesitant', 2: 'dot dot-slow', 3: 'dot dot-growth', 4: 'dot dot-stable' };
