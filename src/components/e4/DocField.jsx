// 可编辑最终文档的区域原子。
// 点击静态值就地切换成对应控件：text/long 用 auto-grow 输入，judgment 弹四态菜单，date 用日期输入。
// blur、Cmd/Ctrl+Enter 提交；Esc 取消。不使用 contentEditable 直绑，避免光标跳动与 HTML 注入。
import { useEffect, useRef, useState } from 'react';
import { JUDGMENT_STATES } from '../../lib/e4ReportTemplate.js';

const JUDGMENT_DOT = {
  已确认问题: '#C4535A',
  可能存在: '#C99A3D',
  暂未发现: '#6D9A6A',
  信息不足: '#5B93BC',
};

function AutoGrow({ as: Tag = 'textarea', value, onCommit, onCancel, multiline, ...rest }) {
  const ref = useRef(null);
  const resize = () => {
    const el = ref.current;
    if (el && el.tagName === 'TEXTAREA') {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  };
  useEffect(() => {
    resize();
    ref.current?.focus();
    ref.current?.select?.();
  }, []);
  return (
    <Tag
      {...rest}
      ref={ref}
      className="e4-doc-field-edit"
      value={value}
      rows={multiline ? 3 : 1}
      onChange={(e) => { rest.onChange?.(e); requestAnimationFrame(resize); }}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        if (e.key === 'Enter' && (multiline ? (e.metaKey || e.ctrlKey) : true)) {
          e.preventDefault();
          onCommit(value);
        }
      }}
    />
  );
}

export default function DocField({
  editable = false,
  type = 'text', // text | long | judgment | date
  value = '',
  display, // 只读态/静态态展示文本（不传则用 value）
  placeholder = '—',
  emptyText = '—',
  onCommit,
  ai, // { busy, onGenerate } 可选，hover 工具条
  children,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  // 点击组件外部时关闭判断菜单
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [menuOpen]);

  if (!editable) return <>{children ?? display ?? (value ? value : emptyText)}</>;

  const shown = display ?? value;
  const isEmpty = !String(value ?? '').trim();

  const commit = (v) => {
    setEditing(false);
    setMenuOpen(false);
    const next = String(v ?? '').trim();
    if (next !== String(value ?? '').trim()) onCommit?.(next);
  };

  // 判断类型：点单元格弹四态菜单（不进入文字编辑）
  if (type === 'judgment') {
    return (
      <span ref={rootRef} className={`e4-doc-field ${menuOpen ? 'is-editing' : ''}`}>
        {ai && !menuOpen && (
          <span className="e4-doc-toolbar">
            <button type="button" disabled={ai.busy} onMouseDown={(e) => e.preventDefault()} onClick={ai.onGenerate}>
              {ai.busy ? 'AI…' : 'AI 生成'}
            </button>
          </span>
        )}
        <span
          className="e4-doc-field-value"
          role="button"
          tabIndex={0}
          onClick={() => setMenuOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMenuOpen(true); } }}
        >
          {isEmpty ? <span className="e4-doc-field-placeholder">{emptyText}</span> : shown}
        </span>
        {menuOpen && (
          <span className="e4-doc-judge-menu">
            {JUDGMENT_STATES.map((s) => (
              <button key={s} type="button" onClick={() => commit(s)}>
                <span className="e4-doc-jdot" style={{ background: JUDGMENT_DOT[s] }} />
                {s}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  }

  return (
    <span ref={rootRef} className={`e4-doc-field ${editing ? 'is-editing' : ''} ${isEmpty ? 'is-empty' : ''}`}>
      {ai && !editing && (
        <span className="e4-doc-toolbar">
          <button type="button" disabled={ai.busy} onMouseDown={(e) => e.preventDefault()} onClick={ai.onGenerate}>
            {ai.busy ? 'AI…' : 'AI 生成'}
          </button>
        </span>
      )}
      {editing ? (
        type === 'date' ? (
          <input
            ref={(el) => { if (el) el.focus(); }}
            type="date"
            className="e4-doc-field-edit"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
              if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
            }}
          />
        ) : (
          <AutoGrow
            as={type === 'long' ? 'textarea' : 'input'}
            multiline={type === 'long'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onCommit={() => commit(draft)}
            onCancel={() => { setDraft(value); setEditing(false); }}
            placeholder={placeholder}
          />
        )
      ) : (
        <span
          className="e4-doc-field-value"
          role="button"
          tabIndex={0}
          onClick={() => { setDraft(value); setEditing(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setDraft(value); setEditing(true); } }}
        >
          {isEmpty ? emptyText : shown}
        </span>
      )}
    </span>
  );
}
