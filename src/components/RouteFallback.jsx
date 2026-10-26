// 导师台 / E4 首次加载（懒加载 chunk 下载期间）的安静占位：不抢眼，也不整页闪烁。
export default function RouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}
    >
      加载中…
    </div>
  );
}
