import { validateY4Subpath } from '../api-lib/y4-path.js';

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