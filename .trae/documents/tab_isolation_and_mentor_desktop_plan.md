# 标签页隔离 + 导师桌面版强制 实施计划

## 问题根因（已调研确认）

### 问题 1：多标签页 session 互相干扰
**现象**：标签页 A 登录 admin，标签页 B 登录 student，回到 A 时 UI 变成学生+导师混合。

**根因**：`@supabase/auth-js` 的 `GoTrueClient` 在浏览器环境下会创建 `BroadcastChannel(storageKey)` 跨标签页同步 session（见 `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js` L240-247）。即使我们把 storage 换成 sessionStorage，只要两个标签页的 `storageKey` 相同（均为 `mentor-app-auth`），一个标签页的登录/登出就会通过 BroadcastChannel 广播给所有同 key 的标签页，覆盖对方的 session。

另外，`supabase.js` 的自定义 `getItem` 有 `localStorage` 回退（`sessionStorage.getItem(key) ?? localStorage.getItem(key)`），这是潜在的 session 泄漏通道——一旦 localStorage 里有同名 key 的 session，会被读到。

### 问题 2：导师页桌面/移动版混合
**现象**：导师页出现移动端外壳（顶栏+底部导航）包裹桌面版内容的混合 UI。

**根因**：两个组件的 mobile 判断标准不一致：
- `Layout.jsx` L135：`max-width: 767px` → 窄桌面窗口就被判为 mobile
- `Mentor.jsx` L162：`(pointer: coarse) and (hover: none) and (max-width: 480px)` → 仅真实手机才 mobile

当桌面窗口宽度在 480–767px 时，Layout 用 mobile 布局包裹 `<Outlet/>`，但 Mentor 内部走 `!isMobile` 桌面分支 → 混合。

## 修改文件

1. `src/lib/supabase.js` — 禁用 BroadcastChannel 跨标签页同步；移除 localStorage 回退
2. `src/components/Layout.jsx` — `/mentor` 路由强制走桌面版（isMobile=false）

## 实施步骤

### 步骤 1：禁用 Supabase 跨标签页 session 同步（supabase.js）

在 `createClient` 之前，临时把 `globalThis.BroadcastChannel` 置为 undefined，使 Supabase 跳过 BroadcastChannel 创建。然后恢复（避免影响应用其他可能用到 BroadcastChannel 的逻辑）。

同时把自定义 storage 的 `getItem` 改为只读 sessionStorage（移除 localStorage 回退），彻底切断跨标签页泄漏通道。`setItem` 和 `removeItem` 保持只操作 sessionStorage。

```js
// 在 createClient 之前：
const _BC = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'mentor-app-auth',
    storage: {
      getItem: (key) => sessionStorage.getItem(key),
      setItem: (key, value) => sessionStorage.setItem(key, value),
      removeItem: (key) => sessionStorage.removeItem(key),
    },
  },
  ...
});

// 恢复 BroadcastChannel（Supabase 已创建完毕，后续不影响）
globalThis.BroadcastChannel = _BC;
```

**效果**：每个标签页的 session 只存在于自己的 sessionStorage，登录/登出不广播给其他标签页。同标签页刷新后 session 保留（sessionStorage 跨刷新保留），关闭标签页后销毁。

### 步骤 2：导师路由强制桌面版（Layout.jsx）

在 Layout 中，当 `location.pathname === '/mentor'` 时，覆盖 `isMobile` 为 false，确保导师/管理员永远走桌面布局，不被窄窗口触发移动端外壳。

```js
const isMentorRoute = location.pathname === '/mentor';
const effectiveIsMobile = isMentorRoute ? false : isMobile;
```

把后续所有用到 `isMobile` 的布局判断（`isMentorDesktop`、mobile 布局分支）改用 `effectiveIsMobile`。

## 验证

1. **跨标签页隔离**：
   - 开两个无痕标签页，A 登录 admin，B 登录 student
   - 切回 A，确认仍是导师桌面 UI，未变成学生 UI
   - 在 B 登出，切回 A，确认 A 仍登录
2. **导师桌面版**：
   - 桌面 Safari 窗口宽度调到 600px（480–767 之间），访问 `/mentor`
   - 确认显示桌面版导师 UI，无移动端顶栏/底部导航
   - 真实手机访问 `/mentor`，确认仍走移动版
3. **回归**：`npm run build` 成功；`npm test` 除既有 Learning.test.jsx 失败外全部通过

## 风险

- **禁用 BroadcastChannel**：Supabase 原本用它同步多标签页登出状态。禁用后，同一账号在多个标签页登出时，其他标签页不会自动登出。但本需求明确要求多账号多标签页隔离，这是预期行为。
- **localStorage 回退移除**：如果 localStorage 里残留了旧 session（升级前的默认 key 是 `sb-<ref>-auth-token`，与新 key `mentor-app-auth` 不同，不会被读到），无影响。
- **导师强制桌面版**：真实手机上 `Mentor.jsx` 自身的 strict 检测仍会渲染移动版，Layout 只是不套移动端外壳。需确认手机上 Mentor 移动版仍正常。
