import {
  peek, load, patch, invalidate, put, needsRefresh, status, subscribe, clearAllCaches,
} from '../src/lib/studentCache.js';

// 学生端内存缓存（stale-while-revalidate）：按用户隔离、版本号防竞态、同 key 并发只取一次。

const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('按用户隔离', () => {
  test('A 的数据，换成 B 之后读不到；A 退出（清空）后 A 自己也读不到', async () => {
    await load('A', 'student', async () => ({ rows: ['a-secret'] }));
    expect(peek('A', 'student')).toEqual({ rows: ['a-secret'] });
    expect(peek('B', 'student')).toBeUndefined();
    expect(needsRefresh('B', 'student')).toBe(true);

    clearAllCaches('A');
    expect(peek('A', 'student')).toBeUndefined();
  });

  test('没有 userId 时什么都不缓存、不读出', async () => {
    await load(undefined, 'k', async () => 1);
    put(undefined, 'k', 1);
    patch(undefined, 'k', () => 2);
    expect(peek(undefined, 'k')).toBeUndefined();
  });

  test('clearAllCaches() 不带参数：清空所有人；在途请求的结果不会写回', async () => {
    const d = deferred();
    const p = load('A', 'slow', () => d.promise);
    await load('B', 'x', async () => 'b');
    clearAllCaches();
    d.resolve('late');
    await p;
    expect(peek('A', 'slow')).toBeUndefined();
    expect(peek('B', 'x')).toBeUndefined();
  });
});

describe('stale-while-revalidate', () => {
  test('有缓存时 needsRefresh 只在过期 / 标记失效后为真；失效后仍可读到旧值（先显示再刷新）', async () => {
    await load('A', 'k', async () => 'v1');
    expect(needsRefresh('A', 'k', 60_000)).toBe(false);
    invalidate('A', 'k');
    expect(peek('A', 'k')).toBe('v1');
    expect(needsRefresh('A', 'k', 60_000)).toBe(true);
    await load('A', 'k', async () => 'v2');
    expect(peek('A', 'k')).toBe('v2');
    expect(needsRefresh('A', 'k', 60_000)).toBe(false);
  });

  test('invalidate({ drop: true }) 直接丢弃旧值', async () => {
    await load('A', 'k', async () => 'v1');
    invalidate('A', 'k', { drop: true });
    expect(peek('A', 'k')).toBeUndefined();
  });

  test('同一个 key 并发只取一次', async () => {
    const fetcher = jest.fn(async () => 'once');
    const [a, b] = await Promise.all([load('A', 'k', fetcher), load('A', 'k', fetcher)]);
    expect(a).toBe('once');
    expect(b).toBe('once');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('取数失败：保留旧值，error 可读，不会无限重试', async () => {
    await load('A', 'k', async () => 'good');
    await expect(load('A', 'k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(peek('A', 'k')).toBe('good');
    expect(status('A', 'k').error).toBeTruthy();
    expect(needsRefresh('A', 'k', Infinity)).toBe(false);
  });

  test('publish 给出阶段性结果：订阅者先收到，最终值再覆盖', async () => {
    const seen = [];
    const unsub = subscribe('A', 'k', () => seen.push(peek('A', 'k')));
    const d = deferred();
    const p = load('A', 'k', async ({ publish }) => {
      publish('partial');
      await d.promise;
      return 'full';
    });
    await Promise.resolve();
    expect(peek('A', 'k')).toBe('partial');
    expect(needsRefresh('A', 'k', 0)).toBe(false); // 正在补齐，不重复发起
    d.resolve();
    await p;
    expect(peek('A', 'k')).toBe('full');
    expect(seen).toEqual(['partial', 'full']);
    unsub();
  });
});

describe('自己的操作之后不显示旧数据', () => {
  test('patch 立刻改缓存并通知订阅者', async () => {
    await load('A', 'list', async () => [1, 2]);
    const cb = jest.fn();
    const unsub = subscribe('A', 'list', cb);
    patch('A', 'list', (l) => [0, ...l]);
    expect(peek('A', 'list')).toEqual([0, 1, 2]);
    expect(cb).toHaveBeenCalled();
    unsub();
  });

  test('在途请求在 patch 之前发出：它的旧结果不能盖掉 patch，而是自动以最新状态重取', async () => {
    let dbRows = [1];
    const first = deferred();
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls += 1;
      if (calls === 1) { await first.promise; return [1]; } // 这一次在「保存」之前就发出了，带回旧快照
      return [...dbRows];
    });
    await load('A', 'list', async () => [1]);
    const inflight = load('A', 'list', fetcher);
    dbRows = [2, 1];                                   // 学生保存了一条（数据库已确认）
    patch('A', 'list', (l) => [2, ...l]);
    first.resolve();
    await inflight;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(peek('A', 'list')).toEqual([2, 1]);
  });

  test('在途期间 publish 的阶段性结果，遇到 patch 也会作废', async () => {
    const d = deferred();
    await load('A', 'k', async () => 'old');
    const p = load('A', 'k', async ({ publish }) => { await d.promise; publish('stale-partial'); return 'x'; });
    patch('A', 'k', () => 'patched');
    d.resolve();
    await p.catch(() => {});
    expect(peek('A', 'k')).not.toBe('stale-partial');
  });
});
