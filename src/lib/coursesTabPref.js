import { useEffect, useState } from 'react';

// 底栏显示「课程」（我的 › 设置）：打开后导航多一个「课程」，直达 /me/courses。
// 只存本机，不进数据库；读写失败（隐私模式等）一律按关闭处理。
const KEY = 'yb.coursesTab';
const EVENT = 'yb:courses-tab';

export function getCoursesTab() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setCoursesTab(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 存不了就只在本次生效 */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useCoursesTab() {
  const [on, setOn] = useState(getCoursesTab);
  useEffect(() => {
    const sync = () => setOn(getCoursesTab());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}
