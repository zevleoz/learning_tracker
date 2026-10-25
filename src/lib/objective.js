// 客观评价读取口径（纯函数，导师端分析 / E4 过程报告共用）
//
// 学生端 v2 起客观评价存为字母等第 grade_label（F…A+ 或 'N/A'），score 为空；
// 早期数据可能只有数字 score。这里统一成一个结果，供统计使用：
//   { kind: 'grade', label, value }  字母等第，value 为参考分（百分制区间中点）
//   { kind: 'score', label, value }  旧数据的数字分，label 由分数换算
//   { kind: 'na' }                   N/A 不适用：不计入客观评价，也不计入分母
//   null                             没有客观评价（练习即「待补填」）

import { OBJECTIVE_STEPS } from './sessionRules.js';

// 字母等第 → 参考分（取 sessionRules GRADE_RANGES 区间中点，F 取 50）
export const GRADE_SCORE = {
  'A+': 98, 'A': 95, 'A-': 91, 'B+': 88, 'B': 85, 'B-': 81,
  'C+': 78, 'C': 75, 'C-': 71, 'D+': 68, 'D': 65, 'D-': 61, 'F': 50,
};

const GRADE_LABELS = new Set(OBJECTIVE_STEPS.map((s) => s.label));

/** 数字分 → 字母等第（与 GRADE_RANGES 区间一致） */
export function scoreToGrade(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 97) return 'A+';
  if (n >= 93) return 'A';
  if (n >= 90) return 'A-';
  if (n >= 87) return 'B+';
  if (n >= 83) return 'B';
  if (n >= 80) return 'B-';
  if (n >= 77) return 'C+';
  if (n >= 73) return 'C';
  if (n >= 70) return 'C-';
  if (n >= 67) return 'D+';
  if (n >= 63) return 'D';
  if (n >= 60) return 'D-';
  return 'F';
}

export function objectiveOf(row) {
  if (!row) return null;
  const label = typeof row.grade_label === 'string' ? row.grade_label.trim() : '';
  if (label === 'N/A') return { kind: 'na' };
  if (GRADE_LABELS.has(label)) return { kind: 'grade', label, value: GRADE_SCORE[label] };
  if (row.score != null && row.score !== '' && Number.isFinite(Number(row.score))) {
    const value = Number(row.score);
    return { kind: 'score', label: scoreToGrade(value), value };
  }
  return null;
}

/** 有可计入统计的客观评价（字母等第或数字分；N/A 不算） */
export function hasObjectiveValue(row) {
  const o = objectiveOf(row);
  return !!o && o.kind !== 'na';
}

/** 客观评价为 N/A 不适用 */
export function isObjectiveNA(row) {
  return objectiveOf(row)?.kind === 'na';
}
