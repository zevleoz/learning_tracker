import { validateY4Subpath, resolveY4Subpath } from '../api-lib/y4-path.js';

// 线上回归：Vercel 的 catch-all 路由不一定填充 req.query.path，
// 导致只读 query 的实现拿到空路径 → 误报「缺少 Y4 接口路径」。
describe('resolveY4Subpath（从请求解析子路径）', () => {
  test('req.query.path 为空时从 req.url 解析（线上实测形态）', () => {
    expect(resolveY4Subpath({ url: '/api/y4/students', query: {} })).toBe('students');
    expect(resolveY4Subpath({ url: '/api/y4/students/25/reports?include=1', query: {} })).toBe('students/25/reports');
    expect(resolveY4Subpath({ url: '/api/y4/reports/27/y4-md?include_raw=1', query: {} })).toBe('reports/27/y4-md');
    expect(resolveY4Subpath({ url: '/api/y4/reports/27/e4-protocol' })).toBe('reports/27/e4-protocol');
  });

  test('兼容 req.url 已被裁掉挂载前缀的形态', () => {
    expect(resolveY4Subpath({ url: '/students' })).toBe('students');
    expect(resolveY4Subpath({ url: '/reports/27/e4-protocol' })).toBe('reports/27/e4-protocol');
  });

  test('容忍绝对 URL、尾斜杠与编码', () => {
    expect(resolveY4Subpath({ url: 'https://x.vercel.app/api/y4/students' })).toBe('students');
    expect(resolveY4Subpath({ url: '/api/y4/students/' })).toBe('students');
    expect(resolveY4Subpath({ url: '/api/y4/students%2F25' })).toBe('students/25');
  });

  test('URL 取不到时回退 req.query.path（数组 / 字符串）', () => {
    expect(resolveY4Subpath({ url: '/api/y4/', query: { path: ['students', '25', 'reports'] } }))
      .toBe('students/25/reports');
    expect(resolveY4Subpath({ url: '', query: { path: 'students' } })).toBe('students');
  });

  test('解析结果仍要过白名单（空路径 / 穿越都被拒）', () => {
    const empty = validateY4Subpath(resolveY4Subpath({ url: '/api/y4/' }));
    expect(empty.ok).toBe(false);
    expect(empty.reason).toContain('缺少');
    expect(validateY4Subpath(resolveY4Subpath({ url: '/api/y4/students/../admin' })).ok).toBe(false);
    expect(validateY4Subpath(resolveY4Subpath({ url: '/api/y4/students/25/reports' })).ok).toBe(true);
  });

  test('缺少 url / 空请求不抛异常', () => {
    expect(resolveY4Subpath({})).toBe('');
    expect(resolveY4Subpath(null)).toBe('');
  });
});

describe('validateY4Subpath（SEC-2 路径白名单）', () => {
  test('放行 E4 平台真实使用的四种路径', () => {
    expect(validateY4Subpath('students')).toEqual({ ok: true, subpath: 'students' });
    expect(validateY4Subpath('students/25/reports')).toEqual({ ok: true, subpath: 'students/25/reports' });
    expect(validateY4Subpath('reports/27/e4-protocol')).toEqual({ ok: true, subpath: 'reports/27/e4-protocol' });
    expect(validateY4Subpath('reports/27/y4-md')).toEqual({ ok: true, subpath: 'reports/27/y4-md' });
  });

  test.each([
    [''],
    ['   '],
    ['..'],
    ['../students'],
    ['students/../../admin'],
    ['students/..%2fadmin'],
    ['students%2F25'],
    ['students%2525'],
    ['students\\25'],
    ['students/25/reports/../../admin'],
    ['students/abc/reports'],
    ['students/25/reports/extra'],
    ['reports/27/admin'],
    ['reports/27/e4-protocol/../y4-md'],
    ['admin'],
    ['Students'],
    ['students//25'],
    ['/students'],
    ['students/'],
    ['unknown/25/reports'],
  ])('拒绝 %j', (bad) => {
    const result = validateY4Subpath(bad);
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  test('非字符串输入不抛异常', () => {
    expect(validateY4Subpath(undefined).ok).toBe(false);
    expect(validateY4Subpath(null).ok).toBe(false);
    expect(validateY4Subpath(['students']).ok).toBe(false);
  });
});