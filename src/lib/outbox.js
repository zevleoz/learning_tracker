// 学习记录保存失败的本机暂存队列（localStorage）。
// 网络中断/会话失效导致 insert 失败时，把记录暂存在这里，
// 恢复后自动重试——避免学生"以为保存了其实没存上"。

export const OUTBOX_KEY = 'ybrc-outbox-v1';
const MAX_ITEMS = 50;

export function loadOutbox() {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // 存储满/隐私模式等：静默失败，队列退化为仅内存提示
  }
}

export function enqueueOutbox(item) {
  const items = loadOutbox();
  items.push({
    id: `ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    ...item,
  });
  // 超出上限时丢弃最旧的
  while (items.length > MAX_ITEMS) items.shift();
  persist(items);
  return items;
}

export function removeFromOutbox(id) {
  const items = loadOutbox().filter((x) => x.id !== id);
  persist(items);
  return items;
}
