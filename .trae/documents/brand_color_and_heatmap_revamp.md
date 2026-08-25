# 品牌色对齐 + 对比度提升 + 热力图简化方案

> Ver 2.0 · 待批改

---

## 0. 问题诊断（基于代码实际读取）

### 0a. 品牌色锚点
- `--mentor-color-primary: #B91C1C` ([index.css:11](file:///Users/jefflau/projects/一表人才/src/index.css#L11)) — 导师端主色
- `--brand: #C1272D` ([index.css:238](file:///Users/jefflau/projects/一表人才/src/index.css#L238)) — 哈佛红，数据可视 alert
- `--gold: #D4AF37` ([index.css:240](file:///Users/jefflau/projects/一表人才/src/index.css#L240)) — 品牌金

**品牌 = 暖色系（红 + 金）。** 但当前分类色全是冷色（天蓝/罗兰紫/青碧），与品牌零关联。

### 0b. 对比度不足的根因（HSL 分析）

| 色彩 | HEX | H | S | L | 问题 |
|---|---|---|---|---|---|
| 学 Sky 500 | `#0EA5E9` | 199° | 94% | 48% | 与 Teal 只差 24° 色相，太近 |
| 复 Violet 500 | `#8B5CF6` | 258° | 83% | **66%** | **太亮太 wash out**，与 Sky 明度差 18% 但视觉上显得淡 |
| 练 Teal 500 | `#14B8A6` | 175° | **68%** | 43% | **饱和度不足**，显得浑浊 muddy |

→ 三个色的明度范围 L43-66 跨度够，但 Violet 太亮 + Teal 太灰 = 视觉上区分度不够。

### 0c. CATEGORICAL_PALETTE 12 色的问题
```
#0EA5E9, #06B6D4, #14B8A6, #2DD4BF  → 全在 170-200°（蓝/青/碧 4 色扎堆）
#22C55E, #A16207, #F97316           → 3 色散开
#8B5CF6, #A78BFA, #9333EA, #C084FC  → 全在 260-304°（紫 4 色扎堆）
#64748B                              → slate 兜底
```
→ 如果学生有 4 门理科，很可能分到 4 个相似蓝/碧色；3 门文科可能分到 3 个相似紫色。

### 0d. 热力图过度设计
当前 [SubjectOrderPreferenceChart](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L855-L1075) 每个格子支持多个 tile 堆叠（`flexDirection: column, gap: 3`），tile 高度只有 10px。但用户明确说"同一时段同一天不会有多个学习记录"，所以多 tile 堆叠逻辑完全多余。

---

## 1. 色彩方案提案（请批改）

### 1a. 学 · 复 · 练 分类色（核心改动）

**设计理念**：品牌是暖色（红+金），分类色应至少包含一个暖调来呼应品牌。同时拉深明度和饱和度，让三个色之间有真正的 visual contrast，不是 wash out 的 SaaS 模板感。

| 分类 | 当前 | **提案** | H | S | L | 为什么 |
|---|---|---|---|---|---|---|
| 学 Study | `#0EA5E9` Sky 500 L48 | **`#2563EB` Blue 600** | 217° | 91% | 53% | 深邃权威蓝，与品牌红形成补色对比（红 vs 蓝），明度 L53 比 Sky 500 的 L48 更亮更清晰 |
| 复 Review | `#8B5CF6` Violet 500 L66 | **`#7C3AED` Violet 600** | 262° | 84% | 58% | 紫色含红色成分，**暖调倾向呼应品牌红**；L58 比 L66 更深更饱和，不再 wash out |
| 练 Practice | `#14B8A6` Teal 500 L43 | **`#0D9488` Teal 600** | 175° | 86% | 31% | 饱和度从 68% → 86%，不再 muddy；L31 是三个色里最深的，形成明度梯度（学→复→练 = 浅→中→深） |

**对比度改善**：
- 当前三色 L 范围：43-66（跨度 23，但 Violet 太亮）
- 提案三色 L 范围：31-58（跨度 27，且 Violet 不再过亮）
- 色相间距：Blue 217° → Violet 262° = 45° / Violet 262° → Teal 175° = 87° → 更均衡

### 1b. 自主 · 外部 子分类色

| 分类 | 当前 | **提案** | 为什么 |
|---|---|---|---|
| 自主 Self | `#0EA5E9` Sky 500 | **`#2563EB` Blue 600** | 跟随 Study 主色升级 |
| 外部 External | `#A78BFA` Violet 400 | **`#A78BFA` Violet 400**（不变） | 淡紫仍然一眼归属"非自主"，与 Violet 600 有明度差 |

### 1c. 语义层微调（保持不变，仅记录）

语义层 4 档已经在上一轮调好（good grass / moderate amber / risk orange / alert brand red），与品牌红 `#C1272D` 对齐。**本轮不改语义层。**

### 1d. CATEGORICAL_PALETTE 12 色重排（去重 hue 扎堆）

**当前问题**：4 色扎堆 170-200°，4 色扎堆 260-304°。
**提案**：重新选 12 色，色相间距最大化，避免任何 3 色落在同一个 30° 色窗内。

```js
const CATEGORICAL_PALETTE = [
  '#2563EB', // 0  Blue 600     H217  — 学科分配用，和 cat-study 同色（如果该学生只有"学习"类 session）
  '#0891B2', // 1  Cyan 600     H190
  '#0D9488', // 2  Teal 600     H175  — 和 cat-practice 同色
  '#65A30D', // 3  Lime 600     H86   — 新增暖绿，和 sem-good grass(H142) 距离 56°
  '#CA8A04', // 4  Gold 600     H40   — 品牌金家族，呼应 --gold
  '#DC2626', // 5  Red 600      H0    — 仅 palette 内使用（非 sem-alert 品牌红 #C1272D）
  '#EC4899', // 6  Pink 500     H330
  '#7C3AED', // 7  Violet 600   H262 — 和 cat-review 同色
  '#9333EA', // 8  Purple 600   H271
  '#C026D3', // 9  Fuchsia 600  H291
  '#4F46E5', // 10 Iris 600     H249 — 和 sem-info 同色
  '#64748B', // 11 Slate 500   H217(灰) — 兜底
];
```

等等 — 这里有一个问题：palette 里用了 Red 600 `#DC2626` 和 Gold 600 `#CA8A04`，它们与语义层的 alert `#C1272D` 和 moderate `#F59E0B` 色相很近。虽然明度不同可以区分，但这可能造成新的"一眼乱"。

**修正提案**：palette 里不用 red/gold/amber/orange/grass，只用与语义层完全不相交的 hue：

```js
const CATEGORICAL_PALETTE = [
  '#2563EB', // 0  Blue 600     H217
  '#0891B2', // 1  Cyan 600     H190
  '#0D9488', // 2  Teal 600     H175
  '#6366F1', // 3  Indigo 500   H239
  '#8B5CF6', // 4  Violet 500   H258
  '#9333EA', // 5  Purple 600   H271
  '#C026D3', // 6  Fuchsia 600  H291
  '#DB2777', // 7  Pink 600     H330
  '#0EA5E9', // 8  Sky 500      H199
  '#2DD4BF', // 9  Teal 400     H172
  '#64748B', // 10 Slate 500    H222(灰)
  '#475569', // 11 Slate 600    H215(深灰)
];
```

但这样又有 4 色落在 170-200° 范围（Teal 175, Teal 400 172, Cyan 190, Sky 199）和 4 色落在 239-291° 范围。

**最终提案**：接受色相不完美均匀，但确保相邻 index 的色差最大：

```js
const CATEGORICAL_PALETTE = [
  '#2563EB', // 0  Blue 600     H217  L53
  '#0D9488', // 1  Teal 600     H175  L31  ← 与 0 色相差 42°+ 明度差 22
  '#9333EA', // 2  Purple 600   H271  L41  ← 与 1 色相差 96°
  '#0891B2', // 3  Cyan 600     H190  L37  ← 与 2 色相差 81°
  '#C026D3', // 4  Fuchsia 600  H291  L48  ← 与 3 色相差 101°
  '#4F46E5', // 5  Iris 600     H249  L52  ← 与 4 色相差 42°
  '#DB2777', // 6  Pink 600     H330  L48  ← 与 5 色相差 81°
  '#0EA5E9', // 7  Sky 500      H199  L48  ← 与 6 色相差 131°
  '#8B5CF6', // 8  Violet 500   H258  L66  ← 与 7 色相差 59°（但明度差 18）
  '#2DD4BF', // 9  Teal 400     H172  L63  ← 与 8 色相差 86°+ 明度差 3
  '#64748B', // 10 Slate 500    H222  L43  ← 兜底中性
  '#475569', // 11 Slate 600    H215  L29  ← 兜底深
];
```

→ 相邻 index 之间最小色相差 42°，大部分在 80-130°，区分度比当前版本好很多。

---

## 2. 热力图简化方案（SubjectOrderPreferenceChart）

### 2a. 核心改动：一格一 tile

用户明确说"同一时段同一天不会有多个学习记录"。因此：

- **删除** `tiles.map()` 多 tile 渲染逻辑
- 每个格子只有 0 或 1 个 session
- tile **填满整个格子高度**（不再是 `height: 10`），改为 `height: 100%`
- 格子用 `display: flex; align-items: stretch` 让 tile 自然撑满
- tile 圆角 6px（比当前 4px 更柔和）
- 格子之间 `gap: 4px`（比当前 2px 更透气）

### 2b. tile 内容：保留 title tooltip，不加文字

- 鼠标悬停时显示 `{学科} · {时长}分钟 · {H}:00 时段`
- tile 内不写学科名文字（legend 已经有颜色标注）

### 2c. 简化后的数据计算

- `acc[rowIdx][startH]` 不再是数组，改为单对象 `{ subject, mins }` 或 `null`
- `subjStats` 统计逻辑不变（次数 + 总时长）
- 客观事实统计不变（频次最高时段、平均单节最长、最密的一天）

### 2d. 右侧图例不变

保留当前右侧 vertical 图例面板设计（学科名 + 颜色块 + ×次数），这个设计已经合理。

### 2e. 视觉效果对比

```
当前（多 tile 堆叠，拥挤）：
┌────┬────┬────┬────┬────┐
│周一│ ▢  │    │ ▢▢ │ ▢  │   ← tile 高度 10px，多个堆叠
│周二│    │ ▢  │    │    │
│... │    │    │    │    │

提案（一格一 tile，填满，透气）：
┌────┬────┬────┬────┬────┐
│周一│████│    │████│████│   ← tile 填满格子高度，gap 4px
│周二│    │████│    │    │
│... │    │    │    │    │
```

---

## 3. 受影响文件 & 改动清单

| 文件 | 行号 | 改什么 |
|---|---|---|
| [WeekGrid.jsx](file:///Users/jefflau/projects/一表人才/src/components/WeekGrid.jsx#L7-L15) | L7-15 | CATEGORY_COLORS: Sky→Blue600, Violet500→Violet600, Teal500→Teal600；SELF_COLOR→Blue600 |
| [DeepDivePanels.jsx](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L27-L30) | L27-30 | CATEGORICAL_PALETTE 12 色重排（§1d 最终提案） |
| [DeepDivePanels.jsx](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L227-L230) | L227-230 | SubjectAllocationPanel 的 STU/REV/PRAC 引用自动跟随 CATEGORY_COLORS 升级 |
| [DeepDivePanels.jsx](file:///Users/jefflau/projects/一表人才/src/components/DeepDivePanels.jsx#L855-L1075) | L855-1075 | SubjectOrderPreferenceChart 重写：单 tile 填满格子 + 删除多 tile 堆叠 |
| [DimensionStrip.jsx](file:///Users/jefflau/projects/一表人才/src/components/DimensionStrip.jsx#L176-L182) | L176-182 | 周中/周末双进度条颜色跟随 SELF_COLOR + EXTERNAL_COLOR 自动升级 |
| [index.css](file:///Users/jefflau/projects/一表人才/src/index.css#L255-L260) | L255-260 | CSS 变量 --cat-study/review/practice/self 更新为新 hex |

---

## 4. 验收标准

1. ✅ 学=Blue600 / 复=Violet600 / 练=Teal600 在 WeekGrid 周历、SubjectAllocationPanel 堆叠条、DimensionStrip 双进度条里一致
2. ✅ 三色明度梯度 L53→L58→L31 形成清晰对比，不再 wash out
3. ✅ Violet 600 含红色成分，呼应品牌暖色系
4. ✅ CATEGORICAL_PALETTE 12 色相邻 index 色相差 ≥ 42°
5. ✅ 热力图每格最多 1 个 tile，填满格子高度，gap 4px
6. ✅ 品牌红 `#C1272D` 只出现在 logo/primary/alert，不被分类色或 palette 使用

---

## 5. 请批改的 2 个决策点

| # | 问题 | 我的建议 | 备选 |
|---|---|---|---|
| **B1** | 学/复/练 三色是否用 Blue600/Violet600/Teal600 这组"深邃饱和"方案 | ✅ 是。L53/58/31 明度梯度好，Violet 含暖调呼应品牌 | 保持当前 Sky/Violet/Teal 500 不变，只拉饱和度（改动最小） |
| **B2** | CATEGORICAL_PALETTE 是否用新的 12 色交错排列 | ✅ 是。相邻 index 色相差从 < 30° 提升到 ≥ 42° | 保持当前 12 色，只删掉扎堆的重复 hue（减少到 8 色） |
