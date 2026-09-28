# E4 学生详情页 UI 精修：占位卡片 + 信息层次 + 溢出加固

## Context

学生详情页（`/e4/students/:studentId`，即"每个学生的控制面板"）目前信息层次偏平，只有「会前准备」和「学习力分析报告」两个报告分区，且 `firstReports` 用 `report_type !== 'prep'` 过滤，会把未来出现的 `progress`（过程中报告）错误地混入「学习力分析报告」并硬编码成"首次学习力分析报告"。

本轮目标：
1. 补齐「过程中报告（progress）」占位卡片（用户已确认第三报告 = progress）。
2. 让详情页更 sharp / informative / clear（顶部信息摘要条 + 分区计数/状态徽章 + 更完整的头部 meta）。
3. 过一遍全页溢出/别扭点，做最小化加固（不整页重写）。

约束：中文、无 emoji、桌面优先；不动 `@media print` / `.e4-print-*` / `FirstReportPrint` 只读路径；新 CSS 追加到 `src/index.css` 末尾收口块后；局部 Edit；沿用现有"production desktop"扁平设计语言（white 实底 + 1px hairline `rgba(27,40,56,0.09)` + 10px 直角 + `--e4-ink` 主色）。

## 设计语言基线（复用，不新建）

详情页现由 `.e4-dashboard` 包裹，最终生效的是"桌面级密度体系"段落（`src/index.css` L9030 起）：
- 卡片：`.e4-info-card` / `.e4-report-section` → 白实底 + `rgba(27,40,56,0.09)` hairline + 10px 圆角。
- 报告行：`.e4-report-row` / `.e4-report-row-main` / `.e4-report-name` / `.e4-report-meta` / `.e4-report-row-actions`。
- 徽章：`.e4-status-badge`、`.e4-tag`。
- 主色变量：`--e4-ink #1B2838` / `--e4-navy #2C3E55` / `--e4-ink-3`（辅助灰）。

## 变更

### A. `src/pages/e4/E4StudentDetailPage.jsx`

1. **修正报告过滤**（L55-L56）：
   - `prepReports = reports.filter(r => r.report_type === 'prep')`
   - `firstReports = reports.filter(r => r.report_type === 'first')`
   - 新增 `progressReports = reports.filter(r => r.report_type === 'progress')`

2. **头部 subtitle 补充 meta**（L104-L106）：在 `grade · school · gender` 之后追加 advisor（`student.advisor?.full_name`，有值时）。保持过滤空值 `filter(Boolean).join(' · ')`。

3. **新增顶部信息摘要条**（放在 `.e4-detail-head` 之后、`.e4-detail-cards` 之前；`student.notes` 之后）：
   - 结构（`.e4-detail-summary` 内含 4 个 `.e4-summary-cell`，hairline 分隔）：
     - 会前准备 `prepReports.length`
     - 分析报告 `firstReports.length`
     - 过程报告 `progressReports.length`（为 0 时显示"暂未开放"）
     - Y4 协议 `student.y4_report_id ? '已关联' : '未关联'`（带语义点：已关联=navy 点，未关联=灰点）

4. **新增第三个报告分区「过程中报告」**（放在「学习力分析报告」section 之后）：
   - section 头：`<h2>过程中报告</h2>` + 右侧 `.e4-coming-soon-badge`（"即将推出"）。
   - 有 `progressReports` 时：复用 `.e4-report-row` 结构渲染（name "过程中报告" + status badge + meta 日期 + actions），与现有两区一致。
   - 无数据时：`.e4-card-hint` 文案："基于一表人才追踪数据生成的过程性学习力反馈；当前版本暂未开放。"

### B. `src/index.css`（追加到末尾收口块之后）

新增类（遵循扁平 hairline 语言）：
- `.e4-detail-summary`：横向 flex + `gap: 0` + 1px hairline 边框白底卡片，`padding: 10px 12px`，`margin-bottom: 16px`。
- `.e4-summary-cell`：`flex: 1`，居中，左右用 `border-left: 1px solid rgba(27,40,56,0.08)` 分隔（首个无左边框）。
- `.e4-summary-label`：11px `--e4-ink-3`；`.e4-summary-value`：14px `--e4-ink` 650 weight，`font-variant-numeric: tabular-nums`。
- `.e4-summary-dot`：6px 圆点，`.is-on`(navy) / `.is-off`(灰)。
- `.e4-coming-soon-badge`：11px，中性灰，1px hairline，4px 直角药丸。

溢出加固（最小改动）：
- `.e4-report-row { flex-wrap: wrap; }` + `.e4-report-row-main { min-width: 0; }`，长报告名/按钮组不撑破宽度。
- `.e4-def-list dd { min-width: 0; overflow-wrap: anywhere; }`，长 Y4 uuid/日期不溢出卡片。
- `@media (max-width: 900px) { .e4-dashboard .e4-detail-cards { grid-template-columns: 1fr; } }`，窄窗口两卡堆叠避免挤压（桌面宽屏不受影响）。

## 复用的现成函数/类

- 数据：`listReportsForStudent` (src/lib/e4Store.js L47)，返回 `report_type` 字段，直接用于三区过滤。
- UI 原子：`.e4-info-card-head h2`、`.e4-status-badge`、`.e4-btn-mini`、`.e4-card-hint`、`.e4-report-row*`。
- 导航：`nav('/e4/reports/:id/build')` 等既有路由（过程报告暂无路由/创建函数，占位不接入口）。

## 验证

1. `npm run build`（vite build）通过。
2. `npm test`：95 通过 / 8 既存失败不变（本次不新增测试文件；`__tests__/e4PrepTemplate.test.jsx` 仍 5 过）。
3. 浏览器端到端（`localhost:5174`，账号 `mentor@example.com` / `mentor123`）：
   - `/e4` → 点击某学生进入详情页。
   - 顶部摘要条 4 项计数正确；Y4 状态点正确。
   - 三个报告分区按序显示：会前准备 → 学习力分析报告 → 过程中报告（"即将推出"占位）。
   - 已有关联报告的学生：会前准备/首次报告行正常显示"进入工作台/预览下载"按钮，无错位。
   - 拉窄窗口到 ~900px 以下：两信息卡堆叠、报告行按钮换行，无横向滚动条、无元素被遮挡。
   - 回退到学生列表、进入会前准备工作台（两栏）、打印页，确认无回归、无横向溢出。