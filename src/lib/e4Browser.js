// Safari 打印 E4 报告与 Chrome 不同（用户 Safari 26 实打，见 index.css 的 html.e4-safari 规则）：
// 页面按纸宽等比放大（Letter 约 2.8%），且同一份报告有时在每张纸顶部多出约 21mm（60pt）、
// 有时没有——CSS @page 改不掉，也无法预先知道。所以 Safari 下用更矮的页面，两种情况都放得进一张纸；
// 屏幕预览同样如此（所见即所印）。

export const IS_SAFARI = typeof navigator !== 'undefined'
  && /safari/i.test(navigator.userAgent)
  && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(navigator.userAgent);

if (IS_SAFARI && typeof document !== 'undefined') {
  document.documentElement.classList.add('e4-safari');
}
