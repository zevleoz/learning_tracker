/* =========================================================================
 * sw.js — Service Worker
 * 策略：
 *   - HTML/导航请求：network-first（网络好时用最新，失败回退到缓存）
 *   - CSS/JS/图片：stale-while-revalidate（后台刷新缓存，秒开）
 *   - 同源 /api/* 与 Supabase REST：不拦截不缓存（避免把代理/上游故障固化在本地）
 * ========================================================================= */

const CACHE_NAME = "gpa-tracker-v4";
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
      .then(() => self.clients.matchAll())
      .then((clients) => {
        // 通知各页面：新 SW 已接管，可去拉 version.json 判断哪些面需要更新
        clients.forEach((client) => client.postMessage({ type: "SW_ACTIVATED" }));
      })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 同源 API（/api/y4、/api/llm 等）一律直连网络，绝不缓存：
  // 缓存代理响应会把上游故障/空结果固化在客户端
  if (url.pathname.startsWith("/api/")) return;

  // 版本摘要必须每次直连，否则更新检测会被 SWR 缓存卡住
  if (url.pathname === "/version.json") return;

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

// Web Push：载荷为 /api/notify 发来的 JSON {title, body, url, tag, badge}；badge = 待补填数量，只更新图标角标，不单独推送；
// 兼容旧的纯文本载荷。同一 tag 的通知会互相替换，避免堆叠。
function parsePushPayload(event) {
  const fallback = { title: "一表人才", body: "该打卡啦！", url: "/", tag: "yb-default" };
  if (!event.data) return fallback;
  try {
    const data = event.data.json();
    if (data && typeof data === "object") {
      return {
        title: data.title || fallback.title,
        body: data.body || fallback.body,
        url: data.url || fallback.url,
        tag: data.tag || fallback.tag,
        badge: data.badge != null && Number.isFinite(Number(data.badge)) ? Math.max(0, Math.floor(Number(data.badge))) : null,
      };
    }
  } catch (e) {
    // 非 JSON：当作纯文本正文
  }
  return { ...fallback, body: event.data.text() || fallback.body };
}

self.addEventListener("push", (event) => {
  const { title, body, url, tag, badge } = parsePushPayload(event);
  const tasks = [
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data: { url },
    }),
  ];
  // 桌面图标角标（支持的浏览器才有 setAppBadge；失败静默忽略）
  if (badge !== null && typeof self.navigator !== "undefined" && typeof self.navigator.setAppBadge === "function") {
    tasks.push((async () => { try { await self.navigator.setAppBadge(badge); } catch (e) { /* 角标只是锦上添花 */ } })());
  }
  event.waitUntil(Promise.all(tasks));
});

// 只打开同源地址：载荷里的 url 若不是本站（或格式不对），一律回到应用首页
function safeTarget(raw) {
  const home = new URL("./", self.registration.scope);
  try {
    const target = new URL(raw || "/", self.registration.scope);
    return target.origin === home.origin ? target.href : home.href;
  } catch (e) {
    return home.href;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // 已有同源窗口：聚焦并跳到目标页；否则新开
      for (const client of clients) {
        if (new URL(client.url).origin === new URL(target).origin && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
