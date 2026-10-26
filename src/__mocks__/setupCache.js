// 学生端内存缓存是模块级的，会跨用例残留：每个用例开始前清空，相当于「刚打开应用」。
import { clearAllCaches } from '../lib/studentCache.js';

beforeEach(() => {
  clearAllCaches();
});

// 学生端页面改为懒加载后，findBy* 要多等一次动态 import；机器负载高时默认 1 秒不够，
// 会出现「页面没渲染出来」的偶发失败。放宽到 5 秒（只影响等待上限，不影响通过条件）。
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 5000 });
