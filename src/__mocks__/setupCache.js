// 学生端内存缓存是模块级的，会跨用例残留：每个用例开始前清空，相当于「刚打开应用」。
import { clearAllCaches } from '../lib/studentCache.js';

beforeEach(() => {
  clearAllCaches();
});
