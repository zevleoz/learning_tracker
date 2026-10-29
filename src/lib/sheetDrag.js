// 弹层下拉关闭的判定（纯函数，便于单测）
export const SHEET_CLOSE_PX = 120;       // 手指下拉超过这么多就请求关闭
export const SHEET_CLOSE_VELOCITY = 600; // 快速下甩（px/s）也请求关闭

export function shouldCloseSheet({ offsetY = 0, velocityY = 0 } = {}) {
  return offsetY > SHEET_CLOSE_PX || velocityY > SHEET_CLOSE_VELOCITY;
}
