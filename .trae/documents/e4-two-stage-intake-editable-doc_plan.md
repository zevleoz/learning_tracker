# E4 Two-Stage 产品流改造 实施计划

## Repository Research（现状）

**建档链路（当前为 3 个分散手动步骤）**
1. [StudentFormModal.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/StudentFormModal.jsx)：手动填姓名/性别/年级/学校/备注/关联 tracker
2. [Y4LinkModal.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/Y4LinkModal.jsx)：学生详情页两步手动关联（搜 Y4 学生 → 选报告）
3. [E4ReportBuilderPage.jsx](file:///Users/jefflau/projects/一表人才/src/pages/e4/E4ReportBuilderPage.jsx) 中 `NewFirstFlow`：单独页面点按钮拉 E4 协议（10–30s）→ 建报告 → 跳构建器

**构建器（BuildFlow）4 步**：meta（日期 + 粘贴纪要）→ matrix（38 行；y4Clue 协议预填、meetingNote 手填/AI 批量生成、judgment 四态 pills、筛选 chips）→ judgment（narrative 盒子 + section07）→ finish（4 项必填 checklist + 新开只读打印页 + 标记最终版）。

**打印文档**：[FirstReportPrint.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/FirstReportPrint.jsx) 纯展示、7 页（封面 / 02 说明 / 03–06 四维度 / 07 综合判断），数据源单一 `report.form_data`：
- `cover.{studentName,gender,grade,school,y4Date,reportNature,evidenceSource}`
- `sections[E1..E4].rows[].{rowId,label,y4Clue,meetingNote,judgment,supplementTable}`
- `sections[code].narratives.{coreFinding,followUp,learningImpact,strengths}`
- `section07.{familyQuote,studentQuote,issueOverrides,solutions[],nextReviewDate,nextReviewFocus}`

**Y4 学生对象实测字段**（GET /api/y4/students）：`id, name, gender, grade, school, report_count, latest_report_date`。

**数据层**：[e4Store.js](file:///Users/jefflau/projects/一表人才/src/lib/e4Store.js)；`e4_students` 表（schema.patch-e4.sql L43）已含 gender/grade/school/y4_* 全部字段，**无需 DB 迁移**。

**AI 基础**：已有 `POST /api/llm/meeting-notes`（百炼 qwen3.8-flash，env 已配通），可平行扩展单区域端点。

## 用户已确认的决策
1. 最终输出 = **页内高保真文档，点哪改哪**（与最终 PDF 同布局；真实 PDF 内嵌编辑不可行）
2. 区域上下文 = **智能控件 + 区域 AI 助手**（判断格弹四态、日期格弹日期、方案行可增删；任意区域可让 AI 基于纪要单条生成/重写）
3. 建档 = 只输名字；**每次都显示 Y4 候选确认卡**（即使唯一命中也确认，防认错人）；信息自动带出但可改
4. 会议参考板 = **保留 E1–E4 四维度结构，全面键盘提速**（不做 Trello 式状态分列）

## Files and Modules

**新增**
- `src/pages/e4/E4IntakePage.jsx`：Stage 1 快速建档向导（名字 → Y4 候选确认 → 信息/报告确认 → 自动拉协议建档）
- `src/components/e4/DocField.jsx`：可编辑文档的区域原子（纯文本 / 长文本 / judgment 四态 / 日期 / 表格可增删行）
- `api/llm/cell-note.js`：单区域 AI 生成/重写，返回 note + evidence 原文片段

**修改**
- [src/App.jsx](file:///Users/jefflau/projects/一表人才/src/App.jsx)：加路由 `/e4/new`
- [E4StudentListPage.jsx](file:///Users/jefflau/projects/一表人才/src/pages/e4/E4StudentListPage.jsx)：「新建 E4 学生」改为跳转向导；保留编辑资料入口
- [StudentFormModal.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/StudentFormModal.jsx)：收窄为「编辑资料」用途
- [Y4LinkModal.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/Y4LinkModal.jsx)：关联成功后自动补全档案空白字段（gender/grade/school，仅填空不覆盖）
- [FirstReportPrint.jsx](file:///Users/jefflau/projects/一表人才/src/components/e4/FirstReportPrint.jsx)：加可选 `editable`/`onPatch`，默认 false 时渲染与现状完全一致（打印路由零影响）
- [E4ReportBuilderPage.jsx](file:///Users/jefflau/projects/一表人才/src/pages/e4/E4ReportBuilderPage.jsx)：matrix 键盘提速；纪要侧栏常驻+联动；finish 嵌入可编辑文档（checklist 保留在上）；单条 AI 按钮
- [src/lib/llm.js](file:///Users/jefflau/projects/一表人才/src/lib/llm.js)：`generateCellNote()`
- [src/index.css](file:///Users/jefflau/projects/一表人才/src/index.css)：编辑态/键盘焦点/侧栏样式；**不碰 @media print 与 .e4-print-* 规则**

## Implementation Steps

### Stage 1：快速建档向导
1. 新建 `E4IntakePage`（路由 `/e4/new`），三段式单页：
   - ① 输入名字（唯一必填，debounce 300ms 调 `listStudents(query)`）；**始终展示 Y4 候选卡**（姓名/性别/年级/学校/报告数），单选高亮；底部「以上都不是，仅用名字建档」
   - ② 选中候选后：调 `listReports()` 列报告（默认选最新）；自动带出 gender/grade/school/y4_student_name，全部可改；确认后 `createE4Student()`（直接带 y4_student_id/report_id/date）
   - ③ 自动 `fetchProtocol()`（10–30s，进度条 + 可取消）→ `createFirstReport()` → 跳 `/e4/reports/:id/build`
2. 列表页「新建」入口改跳 `/e4/new`；学生详情页现有「关联 Y4」「生成首次报告」保留（无 Y4 建档的后续补救路径不变）
3. `Y4LinkModal` 关联成功时补全空白性别/年级/学校（仅空值）

### Stage 2-A：会议看板提速（matrix，不改数据流）
4. 键盘流（焦点在行头时）：↑/↓ 移动焦点行；`1-4` 设置四态 judgment；`Enter` 展开/收起行内编辑；`J` 跳到下一条 meetingNote 为空的待核实行；快捷键提示写进按钮 title/提示条
5. 行内编辑：meetingNote textarea auto-grow；编辑态下快捷键不响应（防冲突），Esc 收起
6. 视觉：焦点行明显描边；判断文字加大（保留 6px 小点 + 2px rail 既有扁平语言）；「待核实 N 项」常驻可点
7. 纪要侧栏：遮罩抽屉改为宽屏常驻侧栏（窄屏仍抽屉），内容与当前焦点行联动

### Stage 2-B：可编辑最终文档（finish 步骤）
8. `DocField` 原子：点击显示静态值（带 hover 虚线提示）→ 点击切换控件 → blur 或 Cmd+Enter 提交、Esc 取消。长文本用 auto-grow textarea（不用 contentEditable 直绑，避免光标跳动/HTML 注入）；judgment 用四态小弹层；日期用 date input；section07 方案表/已确认问题表行尾加增删
9. `FirstReportPrint` 加 `editable`/`onPatch`：静态文本节点按绑定表替换为 DocField；绑定路径覆盖封面字段、维度表全部单元格、narrative 盒子、07 双 quote/两张表/复盘日期与重点；`editable=false` 时 DOM 与现状逐元素一致
10. finish 步骤重排：上半保留现有 4 项 checklist（点击跳步骤）；下半内联挂载可编辑文档（纸张分页视觉）；操作区保留「预览/下载 PDF」（走只读打印路由）与「标记最终版」；所有编辑经统一 patch 写 form，自动保存沿用现有 `persist()`

### Stage 2-C：区域 AI 助手
11. 新增 `api/llm/cell-note.js`：入参 `{minutes, label, y4Clue, current?, instruction?}`；出参 `{note, evidence:[片段]}`；prompt 沿用「只用纪要原文、无相关则空、不编造、1–3 句」，另要求摘出 1–3 条原文证据句；本地 vite 中间件按同一模式挂载
12. matrix 展开行加「AI 补这一项」；DocField hover 工具条加「AI 生成 / 重写」；写回对应绑定后自动保存
13. 纪要侧栏：evidence 片段在 minutes 中做 substring 匹配高亮（纯前端、无匹配则不高亮）

## Dependencies and Considerations
- 无 DB 迁移；现有报告/草稿数据结构不变，旧报告直接可编辑
- 打印零影响：editable 默认 false + 编辑控件全部 `.no-print`，打印路由 `/e4/reports/:id/print` 代码不改
- 编辑性能：7 页约 38 行 + 若干盒子，全量挂载压力小；如卡再做视口分页懒挂载
- 协议拉取失败：档案与关联已落库，退回学生详情用现有 new-first 链路重试
- 快捷键与输入中冲突的隔离：仅行头焦点态响应数字/字母键

## Validation
- `npm run build` green；`npx jest` 保持 90 通过 / 8 个既存 Learning 失败
- 浏览器端到端：
  - 建档三路径（唯一命中确认 / 重名候选 / 仅名字建档后关联补全）→ 自动进入 build
  - 矩阵键盘流走查 38 行；AI 批量 + 单条生成
  - finish 页内逐区域编辑（含表格增删行、judgment、日期）→ 打开只读打印路由核对像素一致 → checklist 校验 → 标记最终版
- 打印样式回归：打印预览与改造前对比无布局变化

## Risks
- **editable 改造污染打印组件** → props 默认 false；打印路由不传 editable；完成后用 /e4/print-preview fixture 页人工对比
- **快捷键打断文字输入** → 严格区分行头焦点态与编辑态，编辑态只响应 Esc/Cmd+Enter
- **自动带出覆盖手改** → Y4LinkModal 与向导只填 null/空值，已填值永不覆盖
- **AI 证据片段匹配不到原文** → 高亮降级为不高亮，note 正常写入，不阻断流程
