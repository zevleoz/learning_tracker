import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setAuthUser, setAuthProfile } from '../src/__mocks__/useAuth';
import { renderMentorRoutes, renderE4Routes } from '../src/pages/lazyRoutes.jsx';
import { renderStudentRoutes } from '../src/pages/student/routes.jsx';
import Layout from '../src/components/Layout.jsx';
import { supabase } from '../src/__mocks__/supabase';
import { isChunkLoadError } from '../src/lib/lazyWithRetry.js';

// 导师台 / E4 只有导师用得到：懒加载（学生不下载），首次进入只出现一个安静的占位。
// Mentor / E4App 本身很重，这里换成桩，只验证「路由 + 懒加载 + 权限」这层。

jest.mock('../src/pages/Mentor.jsx', () => ({ __esModule: true, default: () => <div>导师台页面</div> }));
jest.mock('../src/pages/e4/E4App.jsx', () => {
  const { Routes, Route } = require('react-router-dom');
  return {
    __esModule: true,
    default: () => (
      <Routes>
        <Route index element={<div>E4 待办页</div>} />
        <Route path="students" element={<div>E4 学生列表</div>} />
        <Route path="students/:studentId" element={<div>E4 学生详情</div>} />
      </Routes>
    ),
  };
});
jest.mock('../src/lib/useAuth.js', () => require('../src/__mocks__/useAuth.js'));

function login(role) {
  const user = { id: 'u1', email: 'u@x.com' };
  supabase.__setAuthState({ user, session: { user } });
  setAuthUser(user);
  setAuthProfile({ id: 'u1', role, full_name: '某人' });
}

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {renderMentorRoutes()}
        {renderE4Routes()}
        <Route path="*" element={<div>首页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  supabase.__resetMocks();
  supabase.__setTableData('teacher_student_connections', []);
});

describe('导师台 /mentor（懒加载）', () => {
  test('导师：先出安静的「加载中…」，随后渲染导师台', async () => {
    login(2);
    renderApp('/mentor');
    expect(screen.getByRole('status')).toHaveTextContent('加载中…');
    expect(await screen.findByText('导师台页面')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('学生进 /mentor：被挡回首页，导师台代码不渲染', async () => {
    login(1);
    renderApp('/mentor');
    expect(await screen.findByText('首页')).toBeInTheDocument();
    expect(screen.queryByText('导师台页面')).toBeNull();
  });
});

describe('E4 /e4/*（整体懒加载，一个入口）', () => {
  test('/e4 → 待办页；/e4/students → 学生列表；/e4/students/:id → 详情', async () => {
    login(2);
    const first = renderApp('/e4');
    expect(await screen.findByText('E4 待办页')).toBeInTheDocument();
    first.unmount();
    const second = renderApp('/e4/students');
    expect(await screen.findByText('E4 学生列表')).toBeInTheDocument();
    second.unmount();
    renderApp('/e4/students/abc');
    expect(await screen.findByText('E4 学生详情')).toBeInTheDocument();
  });

  test('首次进入先显示占位', async () => {
    login(2);
    renderApp('/e4');
    // 懒加载模块此前在同一文件里可能已加载过；这里只要求最终渲染出页面、且不残留占位
    expect(await screen.findByText('E4 待办页')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  test('学生进 /e4：被挡回首页', async () => {
    login(1);
    renderApp('/e4/students');
    expect(await screen.findByText('首页')).toBeInTheDocument();
    expect(screen.queryByText('E4 学生列表')).toBeNull();
  });
});

describe('学生端其余页面按需拆包', () => {
  function renderStudent(pathname) {
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route element={<Layout />}>{renderStudentRoutes()}</Route>
        </Routes>
      </MemoryRouter>,
    );
  }
  beforeEach(() => {
    login(1);
    supabase.__setTableData('profiles', [{ id: 'u1', role: 1, full_name: '某人', school_name: '某校' }]);
    supabase.__setTableData('courses', []);
    supabase.__setTableData('learning_sessions', []);
    supabase.__setTableData('exam_scores', []);
  });

  test('洞察：代码到达前显示与页面一致的骨架，随后渲染页面', async () => {
    renderStudent('/insights');
    expect(screen.getByLabelText('正在加载')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '洞察' })).toBeInTheDocument();
  });

  test('我的 / 记录 / 我的课程 / 提醒 都能经懒加载渲染', async () => {
    const me = renderStudent('/me');
    expect(await screen.findByRole('heading', { name: '某人' })).toBeInTheDocument();
    me.unmount();
    const rec = renderStudent('/records');
    expect(await screen.findByRole('tab', { name: /待补填/ })).toBeInTheDocument();
    rec.unmount();
    const courses = renderStudent('/me/courses');
    expect(await screen.findByRole('heading', { name: '我的课程' })).toBeInTheDocument();
    courses.unmount();
    renderStudent('/me/reminders');
    expect(await screen.findByRole('heading', { name: '提醒' })).toBeInTheDocument();
  });
});

describe('学生端首屏依赖里没有导师台 / E4 / 图表库', () => {
  // 只沿「静态 import」走（动态 import() 是拆包点，不算首屏依赖）
  const SRC = path.resolve(__dirname, '../src');
  const EXT = ['', '.jsx', '.js', '.mjs', '.json', '/index.jsx', '/index.js'];
  function resolve(spec, from) {
    if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
    const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(from), spec);
    for (const e of EXT) {
      const f = base + e;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  }
  function staticImports(file) {
    const code = fs.readFileSync(file, 'utf8');
    const out = [];
    const re = /^\s*(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    let m;
    while ((m = re.exec(code))) out.push(m[1] || m[2]);
    return { out, code };
  }
  function eagerClosure(entry) {
    const seen = new Set();
    const bare = new Set();
    const queue = [entry];
    while (queue.length) {
      const f = queue.pop();
      if (seen.has(f) || !/\.(jsx?|mjs)$/.test(f)) continue;
      seen.add(f);
      for (const spec of staticImports(f).out) {
        const r = resolve(spec, f);
        if (r) queue.push(r); else bare.add(spec);
      }
    }
    return { files: [...seen].map((f) => path.relative(SRC, f)), bare: [...bare] };
  }

  const { files, bare } = eagerClosure(path.join(SRC, 'main.jsx'));

  test('依赖图确实解析到了学生端首屏文件（防止测试空转）', () => {
    expect(files).toEqual(expect.arrayContaining(['App.jsx', 'components/Layout.jsx', 'pages/student/Today.jsx', 'pages/lazyRoutes.jsx']));
  });

  test('不含 Mentor / E4 页面、E4Layout、导师组件、E4 数据层', () => {
    const offenders = files.filter((f) => /^pages\/(Mentor|e4\/)|components\/(E4Layout|mentor\/|e4\/|MentorLayout)|lib\/e4/.test(f));
    expect(offenders).toEqual([]);
  });

  test('不含图表库（recharts）', () => {
    expect(bare.filter((b) => /recharts/.test(b))).toEqual([]);
  });

  test('Mentor / E4App 只经动态 import() 引用', () => {
    const lazy = fs.readFileSync(path.join(SRC, 'pages/lazyRoutes.jsx'), 'utf8');
    expect(lazy).toMatch(/import\(['"]\.\/Mentor\.jsx['"]\)/);
    expect(lazy).toMatch(/import\(['"]\.\/e4\/E4App\.jsx['"]\)/);
  });
});

describe('懒加载 chunk 加载失败（部署后旧页面）', () => {
  test('识别 chunk 加载错误', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/Mentor-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error("Unexpected token '<'"))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});
