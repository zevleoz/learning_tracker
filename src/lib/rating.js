// 主观自评刻度（20/40/60/80/100）——全平台唯一来源。
// 学生端录入（Learning）与 E4 报告聚合都必须引用这里的值域与文案，
// 不允许各页面自定义另一套刻度或文案。

export const SUBJECTIVE_STEPS = [
  { value: 20, label: '没有听课' },
  { value: 40, label: '像在听天书' },
  { value: 60, label: '有不少没掌握' },
  { value: 80, label: '基本掌握' },
  { value: 100, label: '完全掌握' },
];

// 学生端口径（口语化，用于录入与记录展示）
export const SUBJECTIVE_LABEL = Object.fromEntries(SUBJECTIVE_STEPS.map((s) => [s.value, s.label]));

// 报告口径（书面、克制；值域与学生端一致，仅文案不同）
export const SUBJECTIVE_LABEL_FORMAL = {
  20: '几乎未掌握',
  40: '掌握不足',
  60: '大致掌握',
  80: '基本掌握',
  100: '完全掌握',
};

/**
 * 取主观自评文案。
 * @param {number} value 20/40/60/80/100
 * @param {{ formal?: boolean }} [opts] formal=true 用报告口径
 */
export function subjectiveLabel(value, { formal = false } = {}) {
  const v = Number(value);
  return (formal ? SUBJECTIVE_LABEL_FORMAL : SUBJECTIVE_LABEL)[v] || '';
}