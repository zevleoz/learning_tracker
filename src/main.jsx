import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// SW 只在生产构建注册：开发环境注册会缓存 /api 代理响应与旧 chunk，干扰调试
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // 供版本检测逻辑监听 updatefound / 周期性 update
        window.__SW_REG__ = reg;
      })
      .catch(() => {
        // SW 注册失败不影响应用正常使用，静默处理
      });
  });
}
