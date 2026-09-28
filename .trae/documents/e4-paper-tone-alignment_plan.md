# E4 打印文档 · 最终设计对齐 Implementation Plan

## Repository Research

当前打印实现位于 `src/components/e4/FirstReportPrint.jsx` + `src/index.css` L7858–L8294。模板 `src/lib/e4ReportTemplate.js` 已追加 tint/barColor/accent/supplement 字段（纯追加，旧报告不受影响）。`src/pages/e4/E4PrintPreview.jsx` 是 dev 专属 mock 预览路由（生产不打包到 bundle 因为 import.meta.env.DEV 包裹）。

logo 源文件 `src/logo/logo_color.png` **已包含 "凭远 APP·ARK" + "WORK HARD · DREAM BIG"**（盾形 + 麦穗 + 白色文字），JSX 里额外渲染的 `.e4-brand-text` div 是冗余重复，必须去掉。

用户 5 个具体改动 + 1 个 taste 方向：

| # | 改动 | 范围 |
|---|------|------|
| 1 | **所有虚线都不要** | CSS L7932 `.e4-crop-mark` border dashed（完全删除裁切标记或实线化）、L7949 `.e4-chapter-strip` border-bottom dashed → 改为实线或删除、L7969 `.e4-page-footer` border-top dashed → 改为实线或删除 |
| 2 | **封面 logo 重复** | JSX `BrandEmblem` 组件里的 `.e4-brand-text` div（品牌名 + tagline）必须删除；CSS `.e4-brand-text / .e4-brand-name / .e4-brand-tagline` 全部删除 |
| 3 | **alignment 问题** | 需要系统性排查：section-no 大数字与 title 的 baseline 对齐、表格 cell padding 一致性、cover info table grid-column baseline、narrative box 高度、four-e-row 三列 baseline。参考图整体是严格左对齐的文档风格，没有居中的卡片 |
| 4 | **综合判断颜色更浅** | narrative 盒子 tint 背景当前用 `--e4-red-bg` 等实色 → 加 `opacity: 0.55` 或直接改 CSS var 值；section 07 专用的 quote-card 也应用浅 tint |
| 5 | **整体页面浅黄棕色背景** | PageShell 背景从 `#fff` → 参考图提取的 warm paper 色 `#F7F2E6`（略深于米白，带一点暖调）；表格斑马纹 `tr:nth-child(even)` 和 section 背景同色系 |
| 6 | **Editorial Luxury taste** | 应用 high-end-visual-design skill 的 Editorial Luxury archetype：warm creams, paper feel, 不要 generic borders, 标题字重对比拉大, 行距加宽, 表格斑马纹换成极淡的 warm tone |

### 从参考图重新提取的 alignment 基线

- 封面所有文字（kicker / title / subtitle / intro / 信息表）**全部居中**，logo 居中
- 02–07 页所有内容**左对齐**（章节号、标题、正文、表格），table 不居中
- 表格 `padding: 3.5mm 3mm` 左右一致；表头 `padding: 2.5mm 3mm`
- narrative box `border-left: 2.5pt solid color`，**无圆角**、**无边框**、**极淡 tint 背景**
- section-no 大数字 (32pt 浅灰) 与 section-title (16pt 粗) **baseline 对齐**

### 浅黄棕色背景色板（从参考图提取）

| Token | 值 | 用途 |
|-------|-----|------|
| `--e4-paper` | `#F7F2E6` | 页面主背景（浅米黄） |
| `--e4-paper-dark` | `#EDE6D4` | 表格斑马纹、section 浅背景 |
| `--e4-paper-muted` | `#F0E8D5` | 更淡的辅助 |
| 现有 red/orange/teal/blue 不变，tint 背景 opacity 降为 0.5 | | |

## Files and Modules

- **`src/components/e4/FirstReportPrint.jsx`**：`BrandEmblem` 删除 `.e4-brand-text` div 和多余 `<img>` 包裹结构；其他 JSX 结构不变（之前的结构已经正确）。
- **`src/index.css`** `.e4-print-*` 段（L7858–L8294）：
  - 删除 `.e4-crop-mark` 整个 class（用户要去掉所有虚线，裁切标记是虚线）
  - `.e4-chapter-strip` 去掉 `border-bottom: 1px dashed`（chapter strip 本身保留——它那条虚线是章节分隔感，但参考图那条其实是细线不是虚线，改成实线或删除）
  - `.e4-page-footer` 去掉 `border-top: 1px dashed`
  - `.e4-print-page.e4-page-shell` 背景色 `#fff` → `var(--e4-paper)`
  - 新增 token `--e4-paper / --e4-paper-dark / --e4-paper-muted`
  - `.e4-navy-table tbody tr:nth-child(even)` 背景从 `#fafbfc` → `var(--e4-paper-dark)`
  - `.e4-core-q` 背景从 `#f8fafc` → `var(--e4-paper-muted)`
  - narrative box tint 背景加 `opacity: 0.5`
  - `.e4-brand-emblem` 简化：只有 logo img（高度从 36mm 调大到 52mm 因为现在 logo 包含完整品牌信息）
  - 删除 `.e4-brand-text / .e4-brand-name / .e4-brand-tagline` CSS
  - 封面 kicker / title / subtitle / intro 全部 text-align: center
  - 确保 section-no 与 section-title baseline 对齐（检查 align-items: flex-end 是否正确）
  - verdict 色块 opacity 保持 1（是纯色标记），但 section 07 的 narrative tint 降为 0.5

## Implementation Steps

1. **CSS 改动（index.css）**：新增 paper 色板 token → 删除 crop-mark → 删除 chapter strip / page footer 虚线 → page background 改 paper → 表格斑马纹 / core-q 改 paper 色系 → narrative 背景加 opacity 0.5 → 删除 brand-text CSS → 封面 logo 尺寸调大 → 所有虚线删除
2. **JSX 改动（FirstReportPrint.jsx）**：`BrandEmblem` 删除 `.e4-brand-text` div，只保留 `<img src={logoImg}>`
3. **Build + Test** 验证语法和测试无回归
4. **用户刷新预览对比**：打开 `/e4/print-preview` Cmd+Shift+R

## Dependencies and Considerations

- 删除 crop-mark（裁切 L 标记）可能让用户觉得页面边缘不专业——但用户明确说"所有的虚线都不要"，按要求做。如果后面觉得太空可以换回细实线裁切。
- logo 高度从 36mm 增到 52mm 是因为 logo 文件本身现在包含了完整文字，不再是单独的盾形图。需要实际看效果再微调。
- paper 色 `#F7F2E6` 是用户截图里的浅米黄棕色（像印在再生纸上的感觉）。如果色准不对让用户给具体色值。
- 打印时 `print-color-adjust: exact` 仍保留，paper 色会正确打印。
- narrative box 极淡 tint 背景 + 左边色条 + 无圆角 → 参考图最核心的视觉特征。

## Validation

- `npm run build` 通过
- `npm test` 结果不变（90 pass / 8 fail Learning）
- 刷新 `/e4/print-preview`，逐页对比：无虚线、logo 无重复、背景浅黄棕、对齐正确、综合判断颜色更浅
- 打印预览 Cmd+P 看 A4 分页

## Risks

- **paper 色不准** → 用户截图可能有屏幕色差；先上 `#F7F2E6` 如果偏离目标再调
- **logo 尺寸不确定** → 实际渲染后如果太大或太小微调 CSS `height` 即可
- **alignment 问题具体哪几处** → 用户说 alignment 有问题但没指具体位置；按 baseline 原则统一调整，如果用户反馈具体哪一页/哪一块还有偏差再定点修
- **删除裁切标记后用户觉得太空** → 可快速换回细实线裁切（border: 0.5pt solid #94a3b8）
