import { useCallback, useState } from 'react';
import { loadScope, saveScope } from '../../lib/e4Todos.js';

// 「我的 / 全部」选择状态：默认我的，记在 localStorage（待办事项与学生中心共用）
export function useE4Scope() {
  const [scope, setScopeState] = useState(loadScope);
  const setScope = useCallback((next) => {
    setScopeState(next);
    saveScope(next);
  }, []);
  return [scope, setScope];
}

const OPTIONS = [
  { value: 'mine', label: '我的' },
  { value: 'all', label: '全部' },
];

export default function ScopeSwitch({ value, onChange }) {
  return (
    <div
      role="group"
      aria-label="学生范围"
      className="inline-flex shrink-0 rounded-lg border border-[var(--e4-line-2)] p-0.5"
    >
      {OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1 text-[12.5px] transition-colors ${
              on
                ? 'bg-[var(--e4-bg-3)] font-semibold text-[var(--e4-ink)]'
                : 'text-[var(--e4-ink-2)] hover:text-[var(--e4-ink)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
