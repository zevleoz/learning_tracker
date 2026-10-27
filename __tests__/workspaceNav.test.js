import {
  WORKSPACES,
  workspaceOfPath,
  rememberWorkspacePath,
  lastWorkspacePath,
  lastWorkspace,
  rootWorkspace,
} from '../src/lib/workspaceNav.js';

beforeEach(() => {
  sessionStorage.clear();
});

describe('workspaceOfPath', () => {
  it('识别一表人才和 E4 的路径', () => {
    expect(workspaceOfPath('/mentor')).toBe('tracker');
    expect(workspaceOfPath('/mentor?view=analytics&student=u1')).toBe('tracker');
    expect(workspaceOfPath('/e4')).toBe('e4');
    expect(workspaceOfPath('/e4/students/9')).toBe('e4');
    expect(workspaceOfPath('/e4/students/9?tab=x')).toBe('e4');
  });

  it('其他路径不算任何一个平台', () => {
    expect(workspaceOfPath('/')).toBeNull();
    expect(workspaceOfPath('/today')).toBeNull();
    expect(workspaceOfPath('/mentorx')).toBeNull();
    expect(workspaceOfPath('/e40')).toBeNull();
    expect(workspaceOfPath('')).toBeNull();
    expect(workspaceOfPath(undefined)).toBeNull();
  });
});

describe('rememberWorkspacePath / lastWorkspacePath', () => {
  it('两个平台各自记住最后停留的页面（含查询串）', () => {
    rememberWorkspacePath('e4', '/e4/students/9?tab=report');
    rememberWorkspacePath('tracker', '/mentor?view=analytics&student=u1');
    expect(lastWorkspacePath('e4')).toBe('/e4/students/9?tab=report');
    expect(lastWorkspacePath('tracker')).toBe('/mentor?view=analytics&student=u1');
    expect(lastWorkspace()).toBe('tracker');
  });

  it('没有记录时回平台首页', () => {
    expect(WORKSPACES).toEqual({ tracker: '/mentor', e4: '/e4' });
    expect(lastWorkspacePath('e4')).toBe('/e4');
    expect(lastWorkspacePath('tracker')).toBe('/mentor');
    expect(lastWorkspace()).toBeNull();
  });

  it('不属于该平台的路径不写入', () => {
    rememberWorkspacePath('e4', '/mentor?view=analytics&student=u1');
    expect(lastWorkspacePath('e4')).toBe('/e4');
    expect(lastWorkspace()).toBeNull();
  });

  it('未知平台不写入', () => {
    rememberWorkspacePath('student', '/today');
    expect(lastWorkspace()).toBeNull();
  });

  it('损坏或被改过的记录按没有记录处理', () => {
    sessionStorage.setItem('yb:ws-path:e4', '/mentor?view=students');
    sessionStorage.setItem('yb:ws-last', 'student');
    expect(lastWorkspacePath('e4')).toBe('/e4');
    expect(lastWorkspace()).toBeNull();
  });
});

describe('rootWorkspace', () => {
  it('本标签页上次用过的平台优先于 default_workspace', () => {
    rememberWorkspacePath('tracker', '/mentor?view=syllabus');
    expect(rootWorkspace({ default_workspace: 'e4' })).toBe('tracker');
  });

  it('没有记录时按 default_workspace，缺省落 E4', () => {
    expect(rootWorkspace({ default_workspace: 'tracker' })).toBe('tracker');
    expect(rootWorkspace({ default_workspace: 'e4' })).toBe('e4');
    expect(rootWorkspace(null)).toBe('e4');
  });
});

describe('隐私模式（存储不可用）', () => {
  it('读写抛错时不崩溃，退回平台首页', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(() => rememberWorkspacePath('e4', '/e4/students/9')).not.toThrow();
      expect(lastWorkspacePath('e4')).toBe('/e4');
      expect(lastWorkspace()).toBeNull();
      expect(() => rootWorkspace({ default_workspace: 'tracker' })).not.toThrow();
      expect(rootWorkspace({ default_workspace: 'tracker' })).toBe('tracker');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
