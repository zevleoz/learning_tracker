import { useEffect, useState } from 'react';

// 记录界面偏好（我的 › 记录界面）：'new' = 2.0 记一下 sheet，'classic' = 改版前的内嵌表单。
// 只存本机，不进数据库；读写失败（隐私模式等）一律按新版处理。
const KEY = 'yb.recordUi';
const EVENT = 'yb:record-ui';

export function getRecordUi() {
  try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'new'; } catch { return 'new'; }
}

export function setRecordUi(value) {
  try { localStorage.setItem(KEY, value === 'classic' ? 'classic' : 'new'); } catch { /* 存不了就只在本次生效 */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useRecordUi() {
  const [ui, setUi] = useState(getRecordUi);
  useEffect(() => {
    const sync = () => setUi(getRecordUi());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return ui;
}
