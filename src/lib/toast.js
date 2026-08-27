import { useEffect, useState } from 'react';

const TOAST_EVENT = 'gpa-toast';

export function toast(title, opts = {}) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { id: Math.random().toString(36).slice(2), title, ...opts } }));
}

export function useToasts() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const handler = (e) => {
      const t = e.detail;
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, t.duration || 3500);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);
  return items;
}
