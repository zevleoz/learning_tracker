import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** 刷新当前页面（单独成函数，便于测试替换） */
export function reloadPage() {
  window.location.reload();
}
