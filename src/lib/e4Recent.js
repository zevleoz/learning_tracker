// E4 侧栏「最近查看」：本地记录导师最近打开的学生，最多 6 人
const KEY = 'e4_recent_students_v1';
const MAX = 6;
const EVENT = 'e4-recent-change';

export function getRecentStudents() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function pushRecentStudent({ id, name }) {
  if (!id) return;
  const next = [
    { id, name: name || '未命名学生', ts: Date.now() },
    ...getRecentStudents().filter((r) => r.id !== id),
  ].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // 隐私模式等场景静默降级
  }
}

export function subscribeRecent(fn) {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
