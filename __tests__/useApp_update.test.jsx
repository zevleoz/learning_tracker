import React from 'react';
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  extractSpecifiers,
  reachableFiles,
  changedSurfaces,
  SURFACE_SEEDS,
} from '../scripts/surfaceHashes.js';
import {
  pathToSurface,
  getUsedSurfaces,
  diffSurfaces,
} from '../src/lib/useAppUpdate.js';
import UpdatePrompt from '../src/components/UpdatePrompt.jsx';
import * as utils from '../src/lib/utils.js';

const NOW = 1_700_000_000_000;

describe('import 提取 extractSpecifiers', () => {
  test('覆盖各类 import/export 写法', () => {
    const code = `
      import React from 'react';
      import { a, b } from './a.jsx';
      import './side-effect.css';
      export { c } from './c';
      export * from './d';
      const m = import('./dyn');
    `;
    expect(extractSpecifiers(code)).toEqual([
      'react',
      './a.jsx',
      './side-effect.css',
      './c',
      './d',
      './dyn',
    ]);
  });

  test('无 import 时返回空数组', () => {
    expect(extractSpecifiers('const a = 1; export default a;')).toEqual([]);
  });
});

describe('依赖图推导 reachableFiles', () => {
  // 内存文件图：
  //   student 入口 -> spPage（专属）-> sharedSM（跨学生/导师）-> supabase
  //   mentor 入口  -> mentorPage（专属）-> sharedSM；同时 -> e4Store -> supabase
  //   e4 入口      -> e4Store
  const files = {
    'src/pages/sp.jsx': "import './spPage'",
    'src/pages/spPage.jsx': "import {x} from '../components/sharedSM'",
    'src/pages/mp.jsx': "import './mentorPage'; import './e4Store'",
    'src/pages/mentorPage.jsx': "import {y} from '../components/sharedSM'",
    'src/pages/e4/ep.jsx': "import '../../lib/e4Store'",
    'src/lib/e4Store.js': "import './supabase'",
    'src/components/sharedSM.jsx': "import '../lib/supabase'",
    'src/lib/supabase.js': 'export const z = 1;',
  };

  const normalize = (specifier, importerRel) => {
    const dir = importerRel.split('/').slice(0, -1).join('/');
    const parts = [];
    for (const seg of `${dir}/${specifier}`.split('/')) {
      if (seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    const p = parts.join('/');
    if (files[p]) return p;
    if (files[`${p}.js`]) return `${p}.js`;
    if (files[`${p}.jsx`]) return `${p}.jsx`;
    return null;
  };

  const makeDeps = () => ({
    read: async (rel) => files[rel] ?? null,
    resolve: (specifier, importerRel) => {
      if (!specifier.startsWith('.')) return null;
      return normalize(specifier, importerRel);
    },
  });

  test('专属文件只被对应面触达', async () => {
    const deps = makeDeps();
    const sp = await reachableFiles(['src/pages/sp.jsx'], deps);
    const mp = await reachableFiles(['src/pages/mp.jsx'], deps);
    const ep = await reachableFiles(['src/pages/e4/ep.jsx'], deps);

    expect(sp.has('src/pages/spPage.jsx')).toBe(true);
    expect(sp.has('src/pages/mentorPage.jsx')).toBe(false);
    expect(mp.has('src/pages/mentorPage.jsx')).toBe(true);
    expect(ep.has('src/lib/e4Store.js')).toBe(true);
    expect(sp.has('src/lib/e4Store.js')).toBe(false);
  });

  test('跨面共享文件被多个面触达', async () => {
    const deps = makeDeps();
    const sp = await reachableFiles(['src/pages/sp.jsx'], deps);
    const mp = await reachableFiles(['src/pages/mp.jsx'], deps);
    const ep = await reachableFiles(['src/pages/e4/ep.jsx'], deps);

    // supabase 经 sharedSM/e4Store 被三个面触达
    expect(sp.has('src/lib/supabase.js')).toBe(true);
    expect(mp.has('src/lib/supabase.js')).toBe(true);
    expect(ep.has('src/lib/supabase.js')).toBe(true);
  });

  test('bare import 不进入图', async () => {
    const sp = await reachableFiles(['src/pages/sp.jsx'], makeDeps());
    expect([...sp].some((f) => f.includes('react'))).toBe(false);
  });
});

describe('SURFACE_SEEDS 入口配置', () => {
  test('三个面都有入口定义', () => {
    expect(SURFACE_SEEDS.student.length).toBeGreaterThan(0);
    expect(SURFACE_SEEDS.mentor.length).toBeGreaterThan(0);
    expect(Array.isArray(SURFACE_SEEDS.e4)).toBe(true);
  });
});

describe('changedSurfaces 比对', () => {
  test('只返回使用面中有差异的', () => {
    const current = { student: 's1', mentor: 'm1', e4: 'e1' };
    const remote = { student: 's2', mentor: 'm1', e4: 'e2' };
    expect(changedSurfaces(current, remote, ['mentor', 'e4'])).toEqual(['e4']);
    expect(changedSurfaces(current, remote, ['student', 'mentor'])).toEqual(['student']);
  });
});

describe('路由映射与使用面记录', () => {
  test('pathToSurface', () => {
    expect(pathToSurface('/e4/students')).toBe('e4');
    expect(pathToSurface('/mentor')).toBe('mentor');
    expect(pathToSurface('/learning')).toBe('student');
    expect(pathToSurface('/login')).toBeNull();
  });

  test('getUsedSurfaces 剔除 7 天未用的面', () => {
    localStorage.setItem(
      'app-surface-usage',
      JSON.stringify({
        student: NOW - 1000,
        mentor: NOW - 8 * 24 * 60 * 60 * 1000,
      })
    );
    expect(getUsedSurfaces(NOW)).toEqual(['student']);
  });
});

describe('diffSurfaces 分区检测', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('只改 mentor 面时，学生使用面无变化', () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: NOW }));
    expect(diffSurfaces({ student: undefined, mentor: 'newm' }, NOW)).toEqual([]);
  });

  test('使用面摘要变化时返回该面', () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: NOW, e4: NOW }));
    expect(diffSurfaces({ student: 'news' }, NOW)).toEqual(['student']);
  });

  test('已点过稍后的摘要不再提示', () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: NOW }));
    localStorage.setItem('app-update-dismissed', JSON.stringify({ student: 'news' }));
    expect(diffSurfaces({ student: 'news' }, NOW)).toEqual([]);
  });
});

describe('UpdatePrompt 组件', () => {
  let reloadSpy;

  beforeAll(() => {
    // jsdom 的 location.reload 不可替换，spy 应用层 reloadPage 接缝
    reloadSpy = jest.spyOn(utils, 'reloadPage').mockImplementation(() => {});
  });

  afterAll(() => {
    reloadSpy.mockRestore();
  });

  beforeEach(() => {
    localStorage.clear();
    reloadSpy.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    cleanup();
  });

  const mountAndWait = async (versionJson) => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ surfaces: versionJson }),
    });
    render(<UpdatePrompt />);
    // 标记用户已交互，避免走静默刷新分支
    act(() => window.dispatchEvent(new Event('pointerdown')));
  };

  test('使用面有更新时显示横幅，无更新时不显示', async () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: Date.now() }));
    await mountAndWait({ student: 'newbuild', mentor: 'm' });
    expect(await screen.findByText('学生端有新版本，刷新后生效', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  test('仅导师面更新时不打扰学生', async () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: Date.now() }));
    await mountAndWait({ mentor: 'newm' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  test('点稍后：横幅消失并写入抑制记录', async () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: Date.now() }));
    await mountAndWait({ student: 'newbuild' });
    expect(await screen.findByText(/有新版本/, {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText('稍后'));
    await waitFor(() => expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('app-update-dismissed'))).toEqual({
      student: 'newbuild',
    });
  });

  test('点立即更新：先派发 flush 事件，再刷新', async () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: Date.now() }));
    const flushHandler = jest.fn();
    window.addEventListener('app:before-reload', flushHandler);
    await mountAndWait({ student: 'newbuild' });
    expect(await screen.findByText(/有新版本/, {}, { timeout: 3000 })).toBeInTheDocument();
    fireEvent.click(screen.getByText('立即更新'));
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1));
    expect(flushHandler).toHaveBeenCalledTimes(1);
    window.removeEventListener('app:before-reload', flushHandler);
  });

  test('开机后用户未操作时静默刷新，不显示横幅', async () => {
    localStorage.setItem('app-surface-usage', JSON.stringify({ student: Date.now() }));
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ surfaces: { student: 'newbuild' } }),
    });
    render(<UpdatePrompt />);
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument();
  });
});
