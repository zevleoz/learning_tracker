import {
  growthMapPath, uploadGrowthMap, growthMapUrl, removeGrowthMap,
} from '../src/lib/e4Store.js';
import { supabase } from '../src/__mocks__/supabase.js';

// FEAT-1：成长地图 PDF 从「只存文件引用」改为真正落库到私有 Storage
describe('成长地图 Storage 落库（FEAT-1）', () => {
  beforeEach(() => {
    supabase.__resetMocks();
  });

  it('路径按 {学生}/{报告}/{安全文件名} 组织，非法字符被替换', () => {
    expect(growthMapPath({ e4StudentId: 'stu-1', reportId: 'rep-1', fileName: '成长地图 2026/10.pdf' }))
      .toBe('stu-1/rep-1/成长地图_2026_10.pdf');
    expect(growthMapPath({ e4StudentId: 's', reportId: 'r', fileName: '' }))
      .toBe('s/r/growth-map.pdf');
  });

  it('上传写入 bucket 并返回路径，form_data 只需要存 path', async () => {
    const file = { name: 'gmap.pdf', type: 'application/pdf' };
    const path = await uploadGrowthMap({ e4StudentId: 'stu-1', reportId: 'rep-1', file });
    expect(path).toBe('stu-1/rep-1/gmap.pdf');
    const call = supabase.__getCallHistory().find((c) => c.method === 'storage.upload');
    expect(call.table).toBe('e4-growth-maps');
    expect(call.args.path).toBe('stu-1/rep-1/gmap.pdf');
  });

  it('上传后能生成签名链接（预览 / 下载）', async () => {
    const file = { name: 'gmap.pdf', type: 'application/pdf' };
    const path = await uploadGrowthMap({ e4StudentId: 'stu-1', reportId: 'rep-1', file });
    const url = await growthMapUrl(path);
    expect(url).toContain('e4-growth-maps');
  });

  it('未上传过的路径取链接会报错（便于提示重新上传）', async () => {
    await expect(growthMapUrl('stu-9/rep-9/missing.pdf')).rejects.toThrow('成长地图');
  });

  it('无 path 时不请求存储', async () => {
    expect(await growthMapUrl('')).toBe('');
    expect(await removeGrowthMap('')).toBeUndefined();
  });

  it('删除后链接失效', async () => {
    const file = { name: 'gmap.pdf', type: 'application/pdf' };
    const path = await uploadGrowthMap({ e4StudentId: 'stu-1', reportId: 'rep-1', file });
    await removeGrowthMap(path);
    await expect(growthMapUrl(path)).rejects.toThrow('成长地图');
  });

  it('缺少文件时报错', async () => {
    await expect(uploadGrowthMap({ e4StudentId: 's', reportId: 'r', file: null }))
      .rejects.toThrow('未选择文件');
  });
});