import fs from 'node:fs';
import path from 'node:path';
import { render, screen, act } from '@testing-library/react';
import { createAuthStorage, isStandaloneApp } from '../src/lib/authStorage.js';
import ToastHost from '../src/components/ToastHost.jsx';
import { toast } from '../src/lib/toast.js';
import { reachableFiles, SURFACE_SEEDS } from '../scripts/surfaceHashes.js';

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

describe('登录状态存储：浏览器标签页 vs 主屏幕应用', () => {
  test('浏览器标签页只用 sessionStorage，绝不读 localStorage（多账号标签页互不串号）', () => {
    const local = memStore({ k: 'from-local' });
    const session = memStore();
    const s = createAuthStorage({ standalone: false, local, session });
    expect(s.getItem('k')).toBeNull();
    s.setItem('k', 'v');
    expect(session.dump()).toEqual({ k: 'v' });
    expect(local.dump()).toEqual({ k: 'from-local' });
  });

  test('主屏幕应用用 localStorage，划掉应用后仍保持登录', () => {
    const local = memStore();
    const session = memStore();
    const s = createAuthStorage({ standalone: true, local, session });
    s.setItem('k', 'v');
    expect(local.dump()).toEqual({ k: 'v' });
    expect(session.dump()).toEqual({});
    // 应用重启：sessionStorage 清空，localStorage 仍在
    const again = createAuthStorage({ standalone: true, local, session: memStore() });
    expect(again.getItem('k')).toBe('v');
  });

  test('升级后第一次在主屏幕打开：把 sessionStorage 里已有的登录接过来', () => {
    const local = memStore();
    const session = memStore({ k: 'old' });
    const s = createAuthStorage({ standalone: true, local, session });
    expect(s.getItem('k')).toBe('old');
    expect(local.dump()).toEqual({ k: 'old' });
  });

  test('退出登录两处都清掉', () => {
    const local = memStore({ k: 'a' });
    const session = memStore({ k: 'b' });
    createAuthStorage({ standalone: true, local, session }).removeItem('k');
    expect(local.dump()).toEqual({});
    expect(session.dump()).toEqual({});
  });

  test('存储不可用时不抛错', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('x'); } };
    const s = createAuthStorage({ standalone: true, local: broken, session: broken });
    expect(() => { s.setItem('k', 'v'); s.removeItem('k'); }).not.toThrow();
    expect(s.getItem('k')).toBeNull();
  });

  test('识别主屏幕应用', () => {
    expect(isStandaloneApp({ navigator: { standalone: true } })).toBe(true);
    expect(isStandaloneApp({ navigator: {}, matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandaloneApp({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandaloneApp(undefined)).toBe(false);
  });
});

describe('学生端提示条', () => {
  test('toast() 的消息在学生外壳里显示出来', async () => {
    render(<ToastHost />);
    act(() => { toast('保存失败，请稍后再试', { kind: 'error' }); });
    expect(await screen.findByText('保存失败，请稍后再试')).toHaveClass('toast', 'error');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('更新提示覆盖新的学生端页面', () => {
  const root = path.resolve(__dirname, '..');
  const exts = ['', '.jsx', '.js', '/index.jsx', '/index.js'];
  const deps = {
    read: async (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
    resolve: async (spec, importer) => {
      if (!spec.startsWith('.')) return null;
      const base = path.join(path.dirname(path.join(root, importer)), spec);
      for (const e of exts) {
        const p = base + e;
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(root, p);
      }
      return null;
    },
  };
  test('今天 / 洞察 / 我的 / 记一笔 都计入学生端版本', async () => {
    const files = await reachableFiles(SURFACE_SEEDS.student, deps);
    for (const f of ['src/pages/student/Today.jsx', 'src/pages/student/Insights.jsx', 'src/pages/student/Me.jsx', 'src/components/student/LogSheet.jsx']) {
      expect(files.has(f)).toBe(true);
    }
  });
});
