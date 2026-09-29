# 一表人才 — 项目交接文档（给接续开发 Agent）

> 生成日期：2026-09-25 · 基于对全仓库的调查（代码、spec、测试实跑、git 状态）
> 用途：让新加入的 Agent 快速理解项目全貌、当前进度、风险与下一步工作。

---

## 1. 项目是什么

一个面向学习力测评/辅导场景的 Web 应用，**同一仓库内含两个产品工作区**，共享 Supabase 数据库与登录体系（`profiles.role`：1=学生，2=导师，3=admin）：

| 工作区 | 路由 | 对象 | 状态 |
|---|---|---|---|
| **一表人才 GPA 追踪** | `/syllabus` `/learning` `/review` `/notifications` `/mentor` | 学生记录学习行为，导师查看分析 | 成熟，维护期 |
| **E4 学习力导师平台** | `/e4*` | 导师基于外部 Y4 测评协议生成「会前准备」「首次学习力分析报告」 | **当前开发重心，功能已成型但未提交 git** |

导师登录后按 `profiles.default_workspace`（默认 `e4`）决定落地页，可用侧栏 `WorkspaceSwitch` 切换两个工作区（`src/App.jsx:33`）。

---

## 2. 技术栈与常用命令

- React 18 + Vite 5 + React Router 6 + Tailwind 3 + Supabase JS v2（纯 RLS，无后端业务层）+ recharts + framer-motion
- Vercel Serverless Functions（`api/`）只做两件事：**Y4 代理**（`api/y4/[...path].js` + `api-lib/y4-forward.mjs`，服务端持有 `Y4_API_KEY`）和 **LLM 生成**（`api/llm/` 下 3 个 POST：meeting-notes / cell-note / prep-prefill，OpenAI 兼容接口，默认火山 ARK doubao，env 可切模型）
- 测试：`npm test`（Jest 30 + jsdom + babel，mock 在 `src/__mocks__/`，`jest.config.js` 用 `moduleNameMapper` 重定向 supabase/useAuth）
- 构建：`npm run build`（纯 vite，无 tsc/lint）
- 部署：push `main` → Vercel 自动部署（`vercel.json`，SPA rewrite + `/api/*` serverless）

### 环境变量（键名）

前端（Vite 注入）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`
服务端：`Y4_API_KEY`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_EXTRA_BODY`；可选 `Y4_API_BASE`（默认 `https://report.p4learning-ark.app/api/v1`，Cloudflare Tunnel 域名，2026-09-26 起旧直连 IP 失效，本地/线上统一走域名 + 正常 SNI）

### 本地开发注意点

- `vite.config.js` 有两个自写中间件插件：`y4DevProxy`（本地直连 Y4 域名解析 IP、绕过 SNI 重置）和 `llmDevProxy`（把 `.env.local` 的 `LLM_*` 注入 `process.env` 并本地执行 `api/llm/*.js`，与线上行为一致）
- LLM 未配置时优雅降级（503 + 中文提示），不影响手工流程

---

## 3. 当前最重要的交接事实（务必先读）

1. **E4 子系统全部未提交 git**：`src/pages/e4/`、`src/components/e4/`、`E4Layout.jsx`、`src/lib/e4*.js`、`api/`、`api-lib/`、`supabase/schema.patch-e4.sql`、E4 测试与 fixtures 均为 untracked；另有 13 个已跟踪文件（App.jsx、Mentor.jsx、Learning.jsx、Login.jsx、useAuth.js、vite.config.js 等）处于修改未提交状态。**接续开发第一件事：先提交这批工作**（最新提交是 `24bd178 added 课表快捷链接`）。
2. **测试基线：95 通过 / 8 失败**。8 个失败全部在 `__tests__/Learning.test.jsx`（页面渲染不出预期文本超时），与正在进行的 Learning 页改造（幻影 B+ 修复）不同步有关，属既有基线问题，**不要把它们当成你改坏的东西，但也应修复**。
3. `dist/` 与 `node_modules/.vite` 被 git 跟踪（`.gitignore` 未排除干净），建议清理。
4. **Supabase schema 没有正规迁移流水线**：权威全量是 `supabase/schema.sql`，演进靠根目录 ~28 个手工 `schema.patch-*.sql`（在 SQL Editor 手动执行）。`migrations/` 只有 2 个文件。E4 的表在 `schema.patch-e4.sql`（幂等可重跑），**是否已在生产库应用需以库内实际为准**。
5. 多个 `scripts/` 运维脚本内嵌生产 anon key 与明文 admin 密码（`admin@yibc.com` / `Admin@2026!`），teacher 密钥 `APPARK2026` 的哈希写在迁移注释里——**安全债，需要轮换/清理**。
6. `spec tasks.md` 状态不可信：`.trae/specs/e4-first-meeting-report/tasks.md` 的 Task 1–10 全写 pending，但代码显示 Phase 1 已全部实现并超出（prep 报告、AI 佐证、可编辑文档都是 spec 之后的增量）。完成度以代码和 `.trae/documents/e4-*.md` 为准。

---

## 4. 一表人才 GPA 追踪子系统

### 页面（`src/pages/`）

| 页面 | 职责 |
|---|---|
| `Login.jsx` / `Signup.jsx` | 登录/注册；老师注册需密钥（`verify_teacher_key` → signUp → `register_teacher` RPC 提权，role 以 DB 为权威，不信 user_metadata） |
| `Syllabus.jsx` | 课程大纲树（course→chapter→unit 三级，软删除）。**是共享模型**（同校 RLS 可见），非排课。课程分校内/校外 `course_type` |
| `Learning.jsx`（2182 行） | 学生核心页，三 tab：记录（表单：课程树、类别 学习/复习/练习、行为形式、主观 5 档滑轨、客观等第 A+~F 或稍后补充）、待补填（无客观评价的练习记录）、成绩（`exam_scores` 增删改） |
| `Review.jsx` | 学生仪表盘（`StudentDashboard`，recharts） |
| `Mentor.jsx`（2567 行） | 导师台四 tab：学生管理（邀请/断开/备注名 `mentor_alias`/admin 删除学生/改学校）、数据分析（`WeekReviewDashboard`：时段预设+周历热力+7 维度摘要+DeepDive 下钻）、课表（只读大纲）、系统设置 |
| `Notifications.jsx` | 学生接受/拒绝导师邀请，realtime 订阅 |

### 关键 lib（`src/lib/`）

- `supabase.js`：**重要 hack**——创建 client 前临时禁用 `BroadcastChannel` + 固定 `storageKey`，实现多标签页独立登录（admin/学生互不覆盖，`supabase.js:22-54`）。fetch 统一 10s 超时
- `useAuth.js` → `{user, profile, loading, signOut, isMentor}`；始终信任 DB role
- `date.js`、`toast.js`（事件总线）、`logger.js`（仅 dev）
- `courseUtils` 等在 `src/utils/`

### 数据流

学生注册（trigger 建 profile）→ Syllabus 建课程树 → Learning 写 `learning_sessions`（触发器自动刷 `signals` 预计算表）→ 导师发邀请（`teacher_student_connections` status=0）→ 学生接受（status=1）→ 导师可读该生 sessions/exam_scores（RLS `is_connected_teacher_of()`）。admin 自动连接全部学生。

### 已知问题

- `src/utils/timeUtils.js` 是死代码（无页面引用，仅测试）
- `@legacy` 遗留：`MentorAnalytics.jsx`（`USE_LEGACY_DASHBOARD` flag 切换）、`SharedDashboard.jsx`、`MentorAnalytics.jsx.bak`、`MentorAnalyticsTest.jsx`
- `concepts`/`student_courses`/`daily_checkins`/`mentor_feedback`/`signals` 表已定义但页面基本不再读写
- `schema.sql` 与 001 迁移的 trigger 命名不一致（`handle_new_user` vs `handle_auth_user_profile_sync`，后者会从 user_metadata 恢复 role，与"不信任 metadata"原则有张力）——生产实际状态以库内为准
- `.trae/specs/upgrade-student-end-v2/` 已全部完成（14 项 checklist 全勾）：修掉了「非练习类记录误写 grade_label 的幻影 B+」bug

---

## 5. E4 学习力导师平台（当前开发重心）

### 是什么

基于外部 **Y4 测评系统**（凭远，只读 REST API，协议 v1.2）的学生中心 + 会议驱动导师工作台。核心产物是三类文档，存于同一张 `e4_reports` 表靠 `report_type` 区分：

| report_type | 含义 | 状态 |
|---|---|---|
| `prep` | 首次会议会前准备 | ✅ 全链路（构建器+打印） |
| `first` | 首次学习力分析报告 | ✅ 核心，开发最充分 |
| `progress` | 过程中报告（融合 tracker 数据） | ❌ 只有占位，**最大空白** |

### 页面与路由（`src/App.jsx:78-95`）

| 路由 | 页面 | 要点 |
|---|---|---|
| `/e4` | E4StudentListPage | 学生中心：列表/搜索/排序，骨架屏 |
| `/e4/new` | E4IntakePage | **快速建档向导 3 步**：输名 → debounce 搜 Y4 候选（必须人工确认防认错）→ 确认信息+选报告 → 自动拉协议建报告跳构建器。协议拉取失败时档案已落库，引导详情页重试 |
| `/e4/students/:id` | E4StudentDetailPage | 学生仪表盘：报告分区（prep/first/progress 占位）、Y4 关联卡、右键删报告、「最近查看」 |
| `/e4/students/:id/new-first`、`/e4/reports/:id/build` | E4ReportBuilderPage（1322 行，最大文件） | 4 步：①会议信息（粘贴纪要 ≥100 字出现 AI 批量预填 banner）→ ②核对矩阵（38 行四维度，y4Clue 自动草稿+四态判断 pill，键盘流，AI 补单行，纪要侧栏高亮证据）→ ③综合判断（已确认问题自动汇总、方案、下次复盘必填）→ ④完成（checklist + 页内**可编辑** `FirstReportPrint` + 标记最终版）。**700ms debounce 自动保存** |
| `/e4/reports/:id/print` | E4ReportPrintPage | 只读打印页 |
| `/e4/students/:id/new-prep`、`/e4/prep/:id` | E4PrepPage | 会前准备工作台：左 A4 预览（可编辑 `PrepPrint`），右会议确认清单（键盘速记）+ 成长地图 PDF 上传 + AI 预填学科线索 |
| `/e4/prep/:id/print` | E4PrepPrintPage | 只读打印 |
| `/e4/print-preview`（dev only） | E4PrintPreview | 免登录 Leo mock，迭代打印样式用 |

### 核心 lib

| 文件 | 职责 |
|---|---|
| `e4ProtocolParser.js` | Y4 协议 markdown → 结构化对象（E1–E4 四维度、指标、判断）。**容错设计**：畸形输入返回安全空结构绝不抛异常 |
| `e4ReportTemplate.js` | 30 个固定排查行 + 协议→报告草稿映射（`buildReportDraft`），四态判断，section07 故意留白（导师手写原则） |
| `e4PrepTemplate.js` | 32 行会前准备模板 + `buildPrepDraft`（VERDICT 原文自动录入） |
| `e4Store.js` | Supabase 数据访问层（学生 CRUD 无删除、报告 CRUD，错误包 `E4StoreError`） |
| `y4api.js` / `llm.js` | Y4 / LLM 客户端，只打同源 `/api/*` |
| `e4Recent.js` | 侧栏「最近查看」（localStorage） |

### 组件

`E4Layout.jsx`（侧栏+⌘K 命令面板+工作区切换）、`e4/FirstReportPrint.jsx`（501 行，7 页 A4 版式，暖纸风 `#F7F2E6`+navy 表头）、`e4/PrepPrint.jsx`、`e4/DocField.jsx`（点击就地编辑，非 contentEditable）、`e4/StudentFormModal.jsx`、`e4/Y4LinkModal.jsx`、`e4/E4Modal.jsx`、`WorkspaceSwitch.jsx`、`WorkspacePreference.jsx`

### 端到端数据流（首次报告）

建档 → 代理拉 Y4 学生/报告列表 → 写 `e4_students` → `GET /api/y4/reports/:id/e4-protocol`（Y4 实时 AI 生成 10–30s，可取消，**protocol_md 快照立即落库，重开永不重调**）→ `parseE4Protocol` → `buildReportDraft` 预填 38 行 → 导师加工（纪要 AI 佐证 / 逐行核实四态判断）→ 700ms 自动保存 → 打印页存 PDF；`status` 可显式标记 `final`。

### E4 数据库（`schema.patch-e4.sql`，幂等）

- `e4_students`：档案 + Y4 关联字段（`y4_student_id/y4_report_id` int，外部库不设外键）+ `tracker_profile_id`（progress 预留）
- `e4_reports`：`report_type`('first','progress','prep')、`status`('draft','final')、日期、`minutes_text`、**`protocol_md` 快照**、`form_data` jsonb
- RLS：全部基于 `public.is_mentor()`（role≥2），学生零访问；e4_reports 有 delete 策略

### E4 未完成项（按优先级）

1. **提交 git**（见 §3）
2. **过程中报告（progress）**：schema 约束和详情页占位已就位，无创建入口/构建器/打印模板。规划是融合 tracker 的 learning_sessions/exam_scores 数据
3. **成长地图 PDF**：上传后只存 `{fileName, uploadedAt}` 引用，**文件本身不落库**，AI 读取标注"后续版本接入"（`E4PrepPage` 代码注释 + toast 文案）
4. E4 学生列表无分页（RLS 共享池小，暂可接受）；无删除学生 UI（spec 明确 v1 不做硬删除）
5. `y4-md` 预览链接（spec F11 optional）未实现
6. 若 Y4 升级协议版本：`aliases` 关键词匹配和 `naturalClue` 格式是脆弱点（见 `e4-content-fill_plan.md` 的 risk 节）
7. tasks.md / AC 状态未同步更新（见 §3-6）

---

## 6. 测试

- `npx jest` 实跑（2026-09-25）：9 个 suite、103 用例，**95 通过 / 8 失败**
- 失败全部集中在 `Learning.test.jsx`（8/8，页面渲染超时）——疑似与幻影 B+ 修复改造不同步，**测试还没跟上代码**，需要重写这些测试
- E4 测试全绿：`e4ProtocolParser.test.js`（14 用例，Leo/Catherine 两份真实协议 fixtures 为黄金样本）、`e4PrepTemplate.test.jsx`、`y4api.test.js`
- 项目约定：只增不删测试，项目已有测试体系，新功能需配套测试

---

## 7. 参考样稿与文档

- `E4首次学习力分析报告_更新版(2).docx.pdf`：E4 首次报告版式基准（Leo 案例，打印样式对齐的目标）
- `首次学习力会议会前准备模板.docx`：会前准备模板基准
- `__tests__/fixtures/e4_protocol_25_leo.md` / `e4_protocol_27_catherine.md`：真实 Y4 协议响应样本（解析器测试黄金数据）
- `.trae/specs/e4-first-meeting-report/spec.md`：E4 Phase 1 产品定义（F1–F29 需求、D1–D4 决策、AC-1~13 验收）
- `.trae/documents/e4-*.md`：E4 各轮迭代的实施计划（打印对齐、内容填充、两步建档+可编辑文档、详情页打磨）——**比 spec/tasks 更能反映真实进度**
- `.trae/specs/upgrade-student-end-v2/`：学生端升级（已完成）
- 9 月开发时间线：9/15 mentor 端（多实例登录、删除+备注名）→ 9/21–23 E4 五轮迭代 → 9/24 学生端升级

---

## 8. 建议的接续工作顺序

1. **先提交**：把整个 E4 模块 + 修改的 tracker 文件 + `api/` + E4 schema patch + 测试/fixtures 分批 commit（建议按逻辑拆：E4 基建 → E4 页面 → API/代理 → 测试）。注意 `dist/`、`node_modules/.vite` 不应入库
2. **修 Learning.test.jsx 的 8 个失败**（与幻影 B+ 修复对齐）
3. **确认生产库已应用 `schema.patch-e4.sql`**，并把该文件移入 `supabase/migrations/` 归档
4. 按业务优先级推进 E4：成长地图 PDF 落库（Supabase Storage）→ progress 过程中报告 → 其他
5. 清理安全债：scripts 里的明文密钥/密码、teacher 密钥哈希、被跟踪的 `dist/`
6. 长期：Supabase 手工 patch 模式收敛为正规迁移；`MentorAnalytics.jsx`/`SharedDashboard.jsx` 等 @legacy 代码择机删除

---

## 9. 未来规划（备忘，暂不实施）

- **进程中会议模板**：待设计。方向是提取「一表人才」当前时间段的追踪数据 + 上一次会议的遗留讨论点，做统一分析后预填模板，让整个流程连贯（会前 → 会后 → 进程中）。
- **CRM 上传**：首次会议报告完成后，未来可将报告上传到另一套 CRM；本期不做任何实操。
- **会议驱动的主动提醒已上线（2026-09-29）**：会前准备填入会议日期即同步到 `e4_students.next_meeting_date`（待办从「待安排」变已排期）；会议日期当天结束后，待办页主动提醒导师填写《首次会议记录报告》。首次报告中的下次复盘日期早已会把学生推进到 `progress` 阶段。
