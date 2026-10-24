import { useRef } from 'react';
import { OBJECTIVE_STEPS, GRADE_RANGES } from '../../lib/sessionRules.js';
// 样式：Vite 下照常加载；Jest 未配置 CSS 映射（identity-obj-proxy 未安装），测试环境跳过。
if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
  import('../../styles/student-logging.css');
}

// 客观评价 13 档等第格（A+ … F），可选附带 N/A。
// 单选语义：role="radiogroup" + role="radio"，方向键在格子间移动并选中。
const GRADES_DESC = OBJECTIVE_STEPS.map(s => s.label).reverse();

export default function GradeChips({
  value, onChange, includeNA = false, disabled = false, showBand = true, label = '客观评价等第',
}) {
  const items = includeNA ? [...GRADES_DESC, 'N/A'] : GRADES_DESC;
  const refs = useRef([]);
  const activeIdx = items.indexOf(value);

  function onKeyDown(e, i) {
    const step = { ArrowRight: 1, ArrowDown: 7, ArrowLeft: -1, ArrowUp: -7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = Math.min(items.length - 1, Math.max(0, i + step));
    refs.current[next]?.focus();
    onChange(items[next]);
  }

  return (
    <div>
      <div className="yb-grades" role="radiogroup" aria-label={label}>
        {items.map((g, i) => {
          const on = g === value;
          return (
            <button
              key={g}
              ref={el => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (activeIdx < 0 && i === 0) ? 0 : -1}
              className={g === 'N/A' ? 'na' : undefined}
              disabled={disabled}
              onClick={() => onChange(g)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >{g}</button>
          );
        })}
      </div>
      {showBand && value && GRADE_RANGES[value] && (
        <div className="yb-grades-band"><b>{value}</b> 对应百分制 {GRADE_RANGES[value]}（参考）</div>
      )}
    </div>
  );
}
