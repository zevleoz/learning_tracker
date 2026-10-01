import { AnimatePresence, motion } from 'framer-motion';
import { SURFACE_LABELS, useAppUpdate } from '../lib/useAppUpdate';

/**
 * 新版本提示横幅：固定在视口底部居中，非阻塞。
 * 文案明确告知是哪个使用面有更新；确认后 flush 自动保存并刷新。
 */
export default function UpdatePrompt() {
  const { update, dismiss, applyUpdate } = useAppUpdate();
  const names = update ? update.surfaces.map((s) => SURFACE_LABELS[s] || s).join('、') : '';

  return (
    <AnimatePresence>
      {update && (
        <motion.div
          className="update-prompt"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        >
          <span className="update-prompt-text">{names}有新版本，刷新后生效</span>
          <div className="update-prompt-actions">
            <button type="button" className="update-prompt-later" onClick={dismiss}>
              稍后
            </button>
            <button type="button" className="update-prompt-apply" onClick={applyUpdate}>
              立即更新
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
