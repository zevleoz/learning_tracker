# Y4 上游链路加速与稳定性方案

> 编制：2026-10-08 · 基于当日实测（本机 curl 分段计时 + origin 端口/证书探测 + CF 响应头）
> 背景：E4 建档选学生后「学生报告列表加载失败」，实测确认瓶颈在传输链路而非上游应用

---

## 一、结论（先看这三行）

1. **上游应用本身很快**：复用连接时 `students/48/reports` 首字节仅 **0.26s**；直连 origin（HTTP）仅 **0.016s**。
2. **慢在 Cloudflare 绕行 + 隧道**：经 `report.p4learning-ark.app` 的同一请求 **2.7–8.8s**，偶发 30s 挂起；`cf-ray: …-LAX` 说明我的流量被绕到洛杉矶边缘再回中国 origin。
3. **推荐主路径：给 origin 加一个「灰云（DNS-only）」子域 + TLS，然后把 `Y4_API_BASE` 指过去**——零代码改动（现有实现已支持该环境变量），一行可回退。CF 缓存规则作为并行补充。

### 实测证据

| 观测项 | 数值 |
|---|---|
| DNS 解析 | 4–107ms，`report.p4learning-ark.app` → 172.67.173.75 / 104.21.96.56（Cloudflare anycast） |
| 经 CF 域名：TLS 握手 | 0.56–2.25s |
| 经 CF 域名：TTFB | 0.86–4.16s（偶发 8.8s、30s 挂起） |
| 经 CF 域名：`cf-cache-status` | `DYNAMIC`（完全没走 CF 缓存） |
| 同连接第二次请求 | TLS 0（复用），TTFB **0.26s** |
| **直连 origin `8.153.154.174:80`（带 `Host: report.p4learning-ark.app`）** | **HTTP 200/401，16ms**，返回同一应用（`{"code":"UNAUTHORIZED","error":"无效的 API Key"}`） |
| origin 端口 | 80 开放；**443 不通**（被安全组/防火墙拒绝）；8080/8000/3000 不通 |
| origin Web 服务器 | `nginx/1.18.0 (Ubuntu)` |

结论：**慢的 90% 是「CF 边缘绕行 + 隧道回中国」这段路**，30 秒挂起也发生在这段（隧道重连的典型症状）。上游应用与 origin 网络本身健康。

---

## 二、现状分析（代码侧，已实现的部分）

| 位置 | 现状 |
|---|---|
| [api-lib/y4-forward.mjs](file:///Users/jefflau/projects/一表人才/api-lib/y4-forward.mjs#L4-L5) | `Y4_HOST` / `Y4_API_BASE` 常量，默认 `https://report.p4learning-ark.app/api/v1` |
| [api/y4/[...path].js](file:///Users/jefflau/projects/一表人才/api/y4/[...path].js#L46-L53) | 读 `process.env.Y4_API_BASE` 覆盖默认值；只读列表 `attempts=2` + 阶梯超时 `[6000, 12000]`；`e4-protocol` 不重试、超时 50s |
| [vite.config.js](file:///Users/jefflau/projects/一表人才/vite.config.js#L204-L212) | 本地 dev 代理与线上同参数（同一份 `forwardViaFetch`） |
| [src/lib/y4api.js](file:///Users/jefflau/projects/一表人才/src/lib/y4api.js#L27-L73) | 客户端对 5xx/网络错误再自动重试一次（4xx 与取消不重试） |

已具备的弹性：超时保护 + 服务端重试 + 客户端重试。**但这些都是兜底，不解决「每次都慢 2–8 秒」的根因。**

---

## 三、方案 A（首选，零代码）：origin 直连（灰云子域 + TLS）

> 为什么用「灰云子域」而不是在代码里固定 IP：灰云子域 = DNS 直接解析到 origin，天然是 `IP + 正确 SNI/Host`，可读、可回退、不需要在 Node 里手写 `https.request` 与证书信任链。

### A1. Cloudflare DNS 新增一条灰云记录（用户操作）

- 类型 `A`、名称 `origin`（得到 `origin.p4learning-ark.app`）、内容 `8.153.154.174`
- **代理状态：DNS only（灰云）** ← 关键，不能是橙云

### A2. origin nginx 开启 TLS（用户操作）

当前 443 未监听/被拒。用 Let's Encrypt（Node 默认信任，无需自定义 CA）：

```bash
# 在 origin 上（nginx 1.18 / Ubuntu）
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d origin.p4learning-ark.app   # 自动签发 + 改 nginx 配置
```

nginx 片段（示例，按实际应用端口调整 `proxy_pass`）：

```nginx
server {
  listen 443 ssl http2;
  server_name origin.p4learning-ark.app;

  ssl_certificate     /etc/letsencrypt/live/origin.p4learning-ark.app/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/origin.p4learning-ark.app/privkey.pem;

  location /api/ {
    proxy_pass http://127.0.0.1:8000;      # ← 改成你的应用端口
    proxy_set_header Host $host;
    proxy_read_timeout 120s;               # e4-protocol 会跑 10-30 秒
  }
}
```

另外在阿里云安全组放行 **443**（当前只有 80 开放）。

### A3. 切换上游地址（用户操作，一行）

| 环境 | 变量 | 值 |
|---|---|---|
| Vercel（Production + Preview） | `Y4_API_BASE` | `https://origin.p4learning-ark.app/api/v1` |
| 本地 `.env.local` | `Y4_API_BASE` | 同上（可选，本地也可继续走 CF） |

改完 **Redeploy**。回退方式：把 `Y4_API_BASE` 改回 `https://report.p4learning-ark.app/api/v1` 或删除该变量（代码默认值即 CF 域名）。

### A4. 唯一的未知量：Vercel → 阿里云（中国）的跨海链路

我这里测的 16ms 是**中国境内**到 origin；Vercel 函数（多在美国/香港）到阿里云中国的跨境路由需实测。若跨境不稳，用方案 C1（多端点故障转移）或方案 B。

### A5. 安全注意（必须遵守）

- **不要用明文 HTTP 直连**：API Key 会在公网上明文传输。TLS 未就绪前不要切 A3
- 直连会绕开 Cloudflare WAF：建议阿里云安全组把 443 来源限制为 Vercel 出口 IP 段（或至少保留现有 API Key 校验，它已生效）
- origin 的 80 端口目前对全网开放（任何人都能打 `Host: report.p4learning-ark.app`）——这是既有的暴露面，顺手可以在 A2 里收敛为「80 仅跳转 443」

---

## 四、方案 B（并行做，零代码）：Cloudflare 缓存规则

> 与 A 并行不冲突：A 让我们的调用更快，B 让**所有**调用 CF 的客户端重复查询命中边缘缓存。

### B1. 加 Cache Rule

Cloudflare Dashboard → Caching → Cache Rules → Create rule：
- 匹配：`URI Path` 等于 `/api/v1/students` **或** 匹配 `/api/v1/students/*/reports`
- `Cache eligibility`：**Eligible for cache**
- `Edge TTL`：**Override origin → 30 秒**（列表数据变化慢，30s 足够新）
- `Browser TTL`：Respect origin（对我们无影响，我们的代理是服务端调用）
- 不要给 `reports/*/e4-protocol` 加缓存（会触发上游 AI 生成）

### B2. 关键坑：请求带 `Authorization` 头时 Cloudflare 默认不缓存

我们的代理是带 `Authorization: Bearer <Y4_API_KEY>` 调用的。这条规则**很可能不生效**，判定方法：

```bash
# 连续两次请求同一 URL，第二次期望 cf-cache-status: HIT
curl -sI -H "Authorization: Bearer $Y4_API_KEY" https://report.p4learning-ark.app/api/v1/students | grep -i cf-cache-status
```

若两次都是 `DYNAMIC`（现在就是），二选一：

- **B2a（推荐，需上游小改）**：上游 API 增加接受 `X-Api-Key: <key>` 头（保留 `Authorization` 兼容），我们把 [api-lib/y4-forward.mjs](file:///Users/jefflau/projects/一表人才/api-lib/y4-forward.mjs#L37-L41) 的请求头改成发 `X-Api-Key`。这样请求不再带 `Authorization`，CF 缓存规则即可生效（改动 1 处 + 单测）。
- **B2b（不改代码，需 CF 侧配置）**：用 Transform Rule 在边缘改写/剥离 `Authorization`，同时让 origin 以「来源 IP 白名单 + 自定义头」鉴权。可行但把安全模型变复杂，仅在 B2a 不可行时采用。

### B3. 预期收益与边界

- `students` 列表（建档页每次打开都会调）→ 首个请求后 30s 内命中边缘，**~50–100ms**
- `students/:id/reports` → 每个学生一个 URL，仅当同一学生在窗口内被重复查询才命中；**首次查询仍要走隧道（2–8s）**
- 因此 B 不能替代 A：它救不了「第一次点某学生」的体验

---

## 五、方案 C（可选，代码侧：兜底与加固）

> 建议在 A 上线后按需实施；C1 是 A 的安全网。

### C1. 多端点故障转移（推荐随 A 一起做）

- `api-lib/y4-forward.mjs` 增加 `fallbackBase`：主端点（直连 origin）两次尝试都失败时，自动用备用端点（CF 域名）再试一次
- 环境变量：`Y4_API_BASE_FALLBACK`（默认 `https://report.p4learning-ark.app/api/v1`）
- 调用方：[api/y4/[...path].js](file:///Users/jefflau/projects/一表人才/api/y4/[...path].js#L46-L53) 传入该值；`e4-protocol` 不参与 fallback（避免重复触发 AI 生成）
- 测试：`__tests__/y4Forward.test.js` 增加「主端点超时 → 备用端点成功」「两端都失败 → 报最后错误」两例

### C2. 连接复用（keep-alive）

当前用全局 `fetch`（undici 默认 keep-alive ~4s）。同实例内的连续请求已能复用；若要更激进可加 `undici` 依赖自定义 Agent（`keepAliveTimeout` 拉长）。**建议先不做**，等 A 上线实测后再说——A 已经把单次耗时压到几十毫秒。

### C3. 代理内极短缓存（可选）

代理内对 `students` / `students/:id/reports` 做 15–30s 内存缓存（按实例），减少重复上游调用。注意：`e4-protocol` 绝不缓存；命中率取决于同一实例是否被复用。

---

## 六、方案 D（若坚持走 CF 隧道：定位 30 秒挂起）

1. 在 origin 上看 cloudflared 日志/指标：是否有周期性 `reconnect`、`connection lost`（对应 30s 挂起）
2. 评估双连接器（同机两个 cloudflared 进程 → 两个 CF 边缘路径）或改用 `cloudflared` 的 HA 配置
3. 确认 origin 上行链路稳定性（阿里云 ECS 出口带宽/抖动）
4. 若 CF 侧无法改善，回到方案 A

---

## 七、验收标准与验证步骤

**本地（改 `.env.local` 后 `npx vite`）**

```bash
# 替换为你的导师 token 后连打 10 次，期望 P50 < 0.5s、无 5xx
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "  #$i http=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s\n" \
    --max-time 30 -H "Authorization: Bearer <token>" \
    "http://localhost:5173/api/y4/students/48/reports"
done
```

**线上（部署后）**

1. 建档页选中 Sean → 报告列表应在 1 秒内出现（不再出现「报告列表加载失败」）
2. 浏览器 DevTools → Network → 该请求耗时应 < 1s（当前 2–12s）
3. 若走 CF 缓存（方案 B）：对 `students` 连打两次，第二次响应头应出现 `cf-cache-status: HIT`
4. 20 次连续调用 0 个 5xx

**判定为失败的回退动作**：把 `Y4_API_BASE` 改回 CF 域名（一行环境变量）→ 重新部署，行为回到现状（已有超时+重试兜底）。

---

## 八、假设与决策记录

| 项 | 决策 / 假设 |
|---|---|
| origin 身份 | 假设 `8.153.154.174` 就是同一台 origin（已用 `Host: report.p4learning-ark.app` 验证返回同一鉴权 JSON；nginx 1.18 Ubuntu） |
| 是否在代码里固定 IP | **不采用**。改用灰云子域，等价于「IP + 正确 SNI/Host」，且无需在 Node 里处理自签/Origin CA 信任链 |
| 明文 HTTP 直连 | **不采用**（API Key 会明文过公网） |
| 切换方式 | 只改环境变量 `Y4_API_BASE`，保持现状默认值不变；可一行回退 |
| e4-protocol | 不缓存、不做 fallback、不重试（避免重复触发上游 AI 生成与费用） |
| 优先级 | A（直连）> B（CF 缓存）> C1（故障转移）> D（隧道定位）；C2/C3 视实测再定 |

---

## 九、执行顺序与责任分工

| 步骤 | 谁做 | 产出 |
|---|---|---|
| 1. CF 加灰云 A 记录 `origin` → 8.153.154.174 | 用户 | 新域名可解析到 origin |
| 2. origin 开 TLS（certbot）+ 安全组放行 443 | 用户 | `https://origin.p4learning-ark.app` 可用 |
| 3. Vercel 设 `Y4_API_BASE` → 重新部署 | 用户 | 线上切到直连 |
| 4. 验证（七节） | 用户 / 我（给我线上域名即可代跑） | 通过 / 回退 |
| 5. 若需要 `X-Api-Key` 改造 + C1 故障转移 | 我（代码 + 测试） | 提交并部署 |
| 6. CF 缓存规则（并行） | 用户 | `students` 命中边缘缓存 |
| 7. 隧道侧排查（仅当仍走 CF 且仍有挂起） | 用户 | cloudflared 日志结论 |