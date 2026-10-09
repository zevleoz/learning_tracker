import { validateY4Subpath, resolveY4Subpath, resolveY4Target, resolveY4Search } from '../api-lib/y4-path.js';

// 线上回归（2026-10-09）：Vercel 只把「一段」路径交给 api/y4/[...path].js，
// 多段路径直接被 Vercel 404、函数不被调用。故子路径改由 ?path= 传递。
describe('resolveY4Target（?path= 主形态）', () => {
  test('从 ?path= 取子路径（生产实际请求形态）', () => {
    expect(resolveY4Target({ url: '/api/y4?path=students' })).toEqual({ subpath: 'students', search: '' });
    expect(resolveY4Target({ url: `/api/y4?path=${encodeURIComponent('students/48/reports')}` }))
      .toEqual({ subpath: 'students/48/reports', search: '' });
  });

  test('?path= 里自带的查询串被拆出来单独转给上游', () => {
    const packed = encodeURIComponent('reports/46/y4-md?include_raw=1');
    expect(resolveY4Target({ url: `/api/y4?path=${packed}` }))
      .toEqual({ subpath: 'reports/46/y4-md', search: '?include_raw=1' });
    expect(resolveY4Search({ url: `/api/y4?path=${packed}` })).toBe('?include_raw=1');
  });

  test('?path= 为空时按「缺少路径」处理，不误取其它参数', () => {
    expect(resolveY4Subpath({ url: '/api/y4?path=' })).toBe('');
    expect(resolveY4Subpath({ url: '/api/y4?other=students' })).toBe('');
  });

  test('旧形态（URL 路径自带子路径）仍可解析', () => {
    expect(resolveY4Target({ url: '/api/y4/students/25/reports' }))
      .toEqual({ subpath: 'students/25/reports', search: '' });
    expect(resolveY4Search({ url: '/api/y4/reports/27/y4-md?include_raw=1' })).toBe('?include_raw=1');
  });
});

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