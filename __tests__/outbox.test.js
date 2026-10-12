import { loadOutbox, enqueueOutbox, removeFromOutbox, OUTBOX_KEY } from '../src/lib/outbox.js';

beforeEach(() => {
  localStorage.removeItem(OUTBOX_KEY);
});

describe('outbox · 保存失败暂存队列', () => {
  test('初始为空', () => {
    expect(loadOutbox()).toEqual([]);
  });

  test('enqueue 后可读取，附带 id 与 savedAt', () => {
    enqueueOutbox({ kind: 'learning_session', payload: { session_date: '2026-10-11' } });
    const items = loadOutbox();
    expect(items).toHaveLength(1);
    expect(items[0].payload.session_date).toBe('2026-10-11');
    expect(items[0].id).toBeTruthy();
    expect(items[0].savedAt).toBeTruthy();
  });

  test('多次 enqueue 追加而非覆盖', () => {
    enqueueOutbox({ kind: 'learning_session', payload: { session_date: '2026-10-10' } });
    enqueueOutbox({ kind: 'learning_session', payload: { session_date: '2026-10-11' } });
    expect(loadOutbox()).toHaveLength(2);
  });

  test('removeFromOutbox 按 id 移除', () => {
    enqueueOutbox({ kind: 'learning_session', payload: { session_date: '2026-10-10' } });
    const [item] = loadOutbox();
    removeFromOutbox(item.id);
    expect(loadOutbox()).toEqual([]);
  });

  test('localStorage 内容损坏时返回空数组而不是抛错', () => {
    localStorage.setItem(OUTBOX_KEY, '{broken json');
    expect(loadOutbox()).toEqual([]);
  });

  test('队列上限：超过 50 条时丢弃最旧的', () => {
    for (let i = 0; i < 55; i++) {
      enqueueOutbox({ kind: 'learning_session', payload: { session_date: `2026-08-${String(i % 28 + 1).padStart(2, '0')}` } });
    }
    expect(loadOutbox()).toHaveLength(50);
  });
});
