// Safari 打印与 Chrome 不同（实测 Safari 26，见 index.css 的 html.e4-safari 规则）：
// 每张纸顶部强加约 21mm 空白、底部为 0，且 CSS @page 的页边距改不掉；页面还会按纸宽放大约 2.8%。
// 因此 E4 报告纸张在 Safari 下改用更矮的页面、收紧页面自身的顶部留白，屏幕预览同样如此（所见即所印）。

export const IS_SAFARI = typeof navigator !== 'undefined'
  && /safari/i.test(navigator.userAgent)
  && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(navigator.userAgent);

if (IS_SAFARI && typeof document !== 'undefined') {
  document.documentElement.classList.add('e4-safari');
}
