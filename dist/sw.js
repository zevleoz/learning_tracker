/* =========================================================================
 * sw.js — Service Worker
 * 策略：
 *   - HTML/导航请求：network-first（网络好时用最新，失败回退到缓存）
 *   - CSS/JS/图片：stale-while-revalidate（后台刷新缓存，秒开）
 *   - JSON（Supabase REST）：网络走网络层，不缓存（避免敏感信息留在本地）
 * ========================================================================= */

const CACHE_NAME = "gpa-tracker-v3";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 不缓存 Supabase / 任何跨域的非静态资源
  if (url.hostname.includes("supabase") || request.headers.get("accept")?.includes("application/json")) {
    return;
  }

  const isNavigation = request.mode === "navigate" || request.destination === "document";

  if (isNavigation) {
    // network-first for HTML
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// 简易 Web Push 通知（需要订阅后由后端触发）
self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.text() : "该打卡啦！";
  event.waitUntil(
    self.registration.showNotification("一表人才", {
      body: payload,
      icon: "./icons/icon-192.png",
      data: { url: "./index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./index.html";
  event.waitUntil(self.clients.openWindow(url));
});
