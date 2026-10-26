import { useToasts } from '../lib/toast.js';

/**
 * 学生端外壳里的提示条容器。toast() 通过全局事件派发，之前只有登录/注册页挂了容器，
 * 学生端其余页面的成功/失败提示都不会显示。
 */
export default function ToastHost() {
  const toasts = useToasts();
  return (
    <div className="toast-wrap yb-toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + (t.kind || '')}>{t.title}</div>
      ))}
    </div>
  );
}
