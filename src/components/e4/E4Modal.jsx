import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

// 视口居中的 E4 模态框：内部滚动，整体始终完整可见
export default function E4Modal({ open, onClose, title, subtitle, children, footer, width = 560 }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="e4-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={onClose}
        >
          <motion.div
            className="e4-modal"
            style={{ width: '100%', maxWidth: width }}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="e4-modal-header">
              <div>
                <h3 className="e4-modal-title">{title}</h3>
                {subtitle && <p className="e4-modal-subtitle">{subtitle}</p>}
              </div>
              <button type="button" className="e4-modal-close" onClick={onClose} aria-label="关闭">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="e4-modal-body">{children}</div>
            {footer && <div className="e4-modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
