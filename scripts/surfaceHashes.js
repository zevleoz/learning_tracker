/* =========================================================================
 * surfaceHashes.js — 前端版本分区摘要
 *
 * 不再手工维护「文件 → 使用面」映射表（容易随代码漂移）。
 * 改为从各使用面的入口页面出发，沿静态 import 图自动推导：
 *
 *   student — 学生端一表人才（Learning/Syllabus/Review/Notifications）
 *   mentor  — 导师一表人才台（Mentor/MentorAnalytics）
 *   e4      — E4 工作台（src/pages/e4 下全部页面）
 *
 * 一个文件被哪些面的依赖图触达，就归属于哪些面。例如：
 *   - WeekGrid 被学生和导师同时引用 → 改动后两个面都提示
 *   - e4Store 被 E4 页面和导师页引用 → E4 与导师提示，学生不提示
 *
 * 本模块的图遍历通过 read / resolve 回调访问文件系统，
 * 生产实现由 vite.config.js 提供，测试可注入内存实现。
 * ========================================================================= */

export const SURFACES = ['student', 'mentor', 'e4'];

/**
 * 提取一份源码中的所有 import/export 目标：
 *   import x from 'a' / import 'a' / export { x } from 'a' / import('a')
 * 正则方案，覆盖本项目代码风格；不支持的写法（如模板字符串路径）忽略。
 */
export function extractSpecifiers(code) {
  const specifiers = [];
  // from 前的绑定部分不允许出现引号或分号，避免 lazy 匹配跨过本语句
  const re =
    /(?:\bimport\b|\bexport\b)(?:[^'";]*?\bfrom\s*)?\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(code))) {
    specifiers.push(match[1] || match[2]);
  }
  return specifiers;
}

/** 各使用面的入口（相对仓库根）；e4 入口由 vite.config 读目录生成 */
export const SURFACE_SEEDS = {
  student: [
    'src/pages/Learning.jsx',
    'src/pages/Syllabus.jsx',
    'src/pages/Review.jsx',
    'src/pages/Notifications.jsx',
  ],
  mentor: ['src/pages/Mentor.jsx'],
  e4: [],
};

/**
 * 从入口集合做 BFS，返回可达文件集合（Set<相对路径>）。
 * deps.read(rel)  -> 源码字符串 | null
 * deps.resolve(specifier, importerRel) -> 相对路径 | null（bare import 返回 null）
 */
export async function reachableFiles(seeds, deps) {
  const { read, resolve } = deps;
  const seen = new Set();
  const queue = [...seeds];

  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const code = await read(file);
    if (code == null) continue;

    for (const specifier of extractSpecifiers(code)) {
      const next = await resolve(specifier, file);
      if (next && !seen.has(next) && !queue.includes(next)) queue.push(next);
    }
  }

  return seen;
}

/** 比对当前摘要与远端摘要，仅返回 usedSurfaces 中发生变化的面 */
export function changedSurfaces(current, remote, usedSurfaces) {
  return usedSurfaces.filter((s) => remote && current[s] !== remote[s]);
}
