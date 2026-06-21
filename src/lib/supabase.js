import { createClient } from '@supabase/supabase-js';

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
  || 'https://rkmspodctprrwmeiteos.supabase.co';
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrbXNwb2RjdHBycndtZWl0ZW9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcxNDcsImV4cCI6MjA5NzMzMzE0N30.hmV09hgpQ2xcO6PoTJqhuQGvRErxbHuQ76w-Y65p0ZM';

export const supabase = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

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
