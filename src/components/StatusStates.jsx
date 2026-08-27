export function LoadingState({ message = '加载中…' }) {
  return (
    <div className="status-state status-state--loading">
      <div className="status-state__spinner">
        <div className="status-state__spinner-ring" />
      </div>
      <div className="status-state__message">{message}</div>
    </div>
  );
}

export function EmptyState({ icon = '', title = '暂无数据', description = '' }) {
  return (
    <div className="status-state status-state--empty">
      <div className="status-state__icon">{icon}</div>
      <div className="status-state__title">{title}</div>
      {description && <div className="status-state__description">{description}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, message = '操作失败' }) {
  const errorMessage = error?.message || message;
  
  return (
    <div className="status-state status-state--error">
      <div className="status-state__icon"></div>
      <div className="status-state__title">发生错误</div>
      <div className="status-state__description">{errorMessage}</div>
      {onRetry && (
        <button className="status-state__retry" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  );
}

export function NetworkErrorState({ onRetry }) {
  return (
    <div className="status-state status-state--error">
      <div className="status-state__icon"></div>
      <div className="status-state__title">网络连接异常</div>
      <div className="status-state__description">请检查网络连接后重试</div>
      {onRetry && (
        <button className="status-state__retry" onClick={onRetry}>
          重新连接
        </button>
      )}
    </div>
  );
}
