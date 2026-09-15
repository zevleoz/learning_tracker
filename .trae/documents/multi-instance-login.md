# 多实例登录：支持同一浏览器多标签页登录不同账号

## Context

当前 [src/lib/supabase.js](file:///Users/jefflau/projects/一表人才/src/lib/supabase.js) L22-23 的 `createClient` 没有显式设置 `auth.storageKey`，所以所有标签页共享默认的 `sb-<project-ref>-auth-token` localStorage key。后果：

- **同一浏览器**：在标签页 A 登录 admin 后，标签页 B 的 session 会被覆盖；登录 B 会把 A 挤下线。
- **不同设备/同事**：Supabase 默认允许多设备并发登录，**没有任何 DB 层单会话强制**（已确认 schema.sql 无 sessions 表、无 trigger）。所以"同事不能同时登录同一账号"其实不存在，真正的问题只在同一浏览器的多标签页。

需求：老师能在同一台电脑、同一个 Safari 里开两个标签页——一个登录 admin/mentor 看后台，一个登录学生账号看学生端——互不干扰。同事用同一账号在自己设备登录也不受影响。

用户已确认：
- 方案：`sessionStorage` 隔离（每个标签页独立 session）
- 跨标签页：完全隔离，不做通知

## Approach

只需改一个文件：[src/lib/supabase.js](file:///Users/jefflau/projects/一表人才/src/lib/supabase.js)。

### 改动详情

把 L22-33 的 `createClient` 选项扩展：

```jsx
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // 每个标签页独立 session：admin 标签页与学生标签页互不覆盖
    storageKey: 'mentor-app-auth',  // 显式命名，便于排查；与默认 key 不同
    storage: {
      getItem: (key) => {
        // 优先 sessionStorage（标签页隔离），回退 localStorage（兼容旧标签页）
        return sessionStorage.getItem(key) ?? localStorage.getItem(key);
      },
      setItem: (key, value) => {
        sessionStorage.setItem(key, value);
        // 不写 localStorage，避免又回到所有标签共享
      },
      removeItem: (key) => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);  // 清掉旧的默认 key 里的残留
      },
    },
  },
  schema: 'public',
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
      });
    }
  }
});
```

**为什么这么写**：

- `storage` 改为 sessionStorage → 每个标签页是独立的 browsing context，sessionStorage 互不共享，`storage` 事件也不会跨标签页触发。这是"两个标签页两个登录"的物理隔离。
- `storageKey` 显式命名为 `mentor-app-auth` → 与旧默认 key `sb-<ref>-auth-token` 不同，避免新旧 key 共存造成混乱。
- `getItem` 回退 localStorage → **兼容性**：现有已登录用户的旧 session 还存在 localStorage 的旧 key 里。用户第一次打开新版本时，如果 sessionStorage 没有，会尝试从 localStorage 读取旧的默认 key（不行，key 名变了）——所以严格说旧 session 会失效，用户需要重新登录一次。这是不可避免的代价，因为换 key 就等于换存储位置。
- `removeItem` 同时清 sessionStorage 和 localStorage → 登出时把两边残留都清掉，干净。
- 其他文件（`useAuth.js`、`Login.jsx`、`App.jsx`、`ProtectedRoute.jsx`）**完全不用改**。它们通过 `supabase.auth.getSession()` / `onAuthStateChange` / `signInWithPassword` / `signOut` 间接使用 storage，Supabase SDK 会自动走我们配置的 `storage`。

### 关于"同事多设备登录同一账号"

不需要任何代码改动。Supabase Auth 默认就允许多设备并发 session，没有单会话强制。已确认 schema.sql 无相关 trigger/policy。

## 不需要做的事

- ❌ 不用改 `useAuth.js`（L33-40 的 `getSession`/`onAuthStateChange` 会自动用新 storage）
- ❌ 不用改 `Login.jsx`（L126 的 `signInWithPassword` 会自动写新 storage）
- ❌ 不用改 `App.jsx` / `ProtectedRoute.jsx`（路由守卫读 `profile.role`，与 storage 无关）
- ❌ 不用改任何 SQL（无 DB 层单会话强制）
- ❌ 不用改 mentor dashboard 刚加的 delete/alias 功能（与 auth 无关）
- ❌ 不用改移动端代码（auth 改动对所有页面统一生效）

## 副作用与权衡

1. **现有用户首次打开新版本需要重新登录一次**：因为 storageKey 改了名，旧 session 存在旧 key 里读不到。这是不可避免的代价，但只发生一次。
2. **标签关闭后 session 丢失**：这是 sessionStorage 的本质——关闭标签页 = 丢 session。用户需要重新登录。这正是"完全隔离"的代价，用户已确认接受。
3. **刷新标签页会保留 session**：sessionStorage 在标签页存活期间（包括刷新、导航）都保留，所以刷新不会丢登录。
4. **"复制标签页"或"新标签页打开同 URL"不会继承登录**：新标签页是新的 sessionStorage，需要重新登录。这是预期行为。
5. **同事在自己设备登录同一账号**：完全不受影响，Supabase 服务端允许多设备并发。

## Verification

### 手动测试（本地 `npm run dev`）

1. **基本登录回归**：
   - 启动 dev 服务器，打开 Safari，访问 `/login`
   - 用 admin 账号登录 → 跳到 `/mentor`
   - 刷新页面 → 仍登录（sessionStorage 跨刷新保留）
   - 关闭标签页，重开 → 回到登录页（sessionStorage 随标签关闭销毁，符合预期）

2. **多标签页隔离**：
   - 标签页 A：登录 admin → `/mentor`
   - 标签页 B（新开标签，不是 duplicate）：打开同 URL → 应该在 `/login`（A 的 session 不共享到 B）
   - 标签页 B：登录学生账号 → `/syllabus`
   - 回到标签页 A：刷新 → 仍是 admin 登录（B 的登录没影响 A）
   - 回到标签页 B：刷新 → 仍是学生登录（A 的 admin 没影响 B）

3. **登出隔离**：
   - 标签页 A：点登出 → 跳到 `/login`
   - 回到标签页 B：刷新 → 仍是学生登录（A 登出没把 B 挤下线）

4. **同事多设备并发**（如果方便用两台设备测）：
   - 设备 X：登录 admin
   - 设备 Y：同一 admin 账号登录 → 应该成功，不会把 X 挤下线（这本来就支持，只是确认）

5. **回归测试**：
   - 导师桌面 dashboard 的 delete/alias 功能仍正常工作
   - 数据分析 tab、学生管理 tab、学习页、Syllabus 页都正常加载
   - 移动端视图正常（DevTools 切手机模拟器）

### 自动化测试

不需要新增 jest 测试——auth storage 是 Supabase SDK 内部行为，单元测试无法有效模拟跨标签页 storage 隔离。手动测试更可靠。现有测试套件应全部通过（Login.test.jsx 已用 mock supabase，不依赖真实 storage）。

### 构建检查

`npm run build` 必须成功，无警告。

## 不在范围内（明确不改）

- mentor dashboard 的 delete/alias 功能（刚做完，不动）
- 移动端视图
- 数据库 schema（无 auth 相关改动）
- 任何其他页面（Signup, Learning, Syllabus, Review, Notifications）
- Supabase Auth 服务端配置（无需改 Dashboard 任何设置）
