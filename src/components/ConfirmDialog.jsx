import { createPortal } from 'react-dom';

/**
 * ConfirmDialog — 共享确认对话框，替代原生 confirm()
 *
 * 在 iOS PWA standalone 模式下，原生 confirm() 会弹出与应用风格不符的系统对话框，
 * 本组件提供与应用 Liquid Glass 风格一致的确认 UI。
 *
 * Props:
 *   - open: bool — 是否显示
 *   - title: string — 标题（默认"确认操作"）
 *   - message: string — 提示内容
 *   - confirmLabel: string — 确认按钮文案（默认"确认"）
 *   - cancelLabel: string — 取消按钮文案（默认"取消"）
 *   - variant: 'primary' | 'danger' — 确认按钮样式（danger 用于删除等危险操作）
 *   - busy: bool — 处理中状态（禁用按钮）
 *   - onConfirm: function — 确认回调
 *   - onCancel: function — 取消回调
 */
export default function ConfirmDialog({
  open,
  title = '确认操作',
  message = '',
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const isDanger = variant === 'danger';
  const confirmStyle = isDanger
    ? { background: 'rgba(239,68,68,0.12)', color: '#b91c1c', borderColor: 'rgba(239,68,68,0.3)' }
    : {};

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'fadeIn 180ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--glass-strong, rgba(255,255,255,0.95))',
          backdropFilter: 'var(--blur-sheet, blur(20px))',
          WebkitBackdropFilter: 'var(--blur-sheet, blur(20px))',
          borderRadius: 20, padding: 24,
          width: '100%', maxWidth: 340,
          border: '1px solid var(--edge-bright, rgba(15,23,42,0.08))',
          boxShadow: '0 2px 6px rgba(15,23,42,0.04), 0 18px 44px rgba(15,23,42,0.12)',
          animation: 'authModalIn 220ms cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700, color: 'var(--text-strong, #0f172a)' }}>{title}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-soft, #64748b)', lineHeight: 1.55 }}>{message}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            disabled={busy}
            className="btn btn-ghost btn-sm"
          >{cancelLabel}</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="btn btn-primary btn-sm"
            style={confirmStyle}
          >{busy ? '处理中…' : confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
