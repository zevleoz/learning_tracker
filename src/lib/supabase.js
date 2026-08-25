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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  schema: 'public',
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
      });
    }
  }
});

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

export const MASTERY_LABEL = { 100: '完全掌握', 75: '基本掌握', 50: '有不少没掌握', 25: '像在听天书' };
export const MASTERY_COLOR = { 100: 'text-emerald-400', 75: 'text-amber-400', 50: 'text-orange-400', 25: 'text-rose-400' };
export const MASTERY_DOT   = { 100: 'dot-growth', 75: 'dot dot-hesitant', 50: 'dot dot-slow', 25: 'dot dot-slow' };

export const SIGNAL_LABEL = { 1: 'Hesitant', 2: 'Slow', 3: 'Growth', 4: 'Stable' };
export const SIGNAL_CARD  = { 1: 'signal-card-hesitant', 2: 'signal-card-slow', 3: 'signal-card-growth', 4: 'signal-card' };
export const SIGNAL_DOT   = { 1: 'dot dot-hesitant', 2: 'dot dot-slow', 3: 'dot dot-growth', 4: 'dot dot-stable' };
