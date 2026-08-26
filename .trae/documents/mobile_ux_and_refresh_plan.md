# 移动端优化 + Refresh 逻辑加固 改进计划

> 生成时间：2026-08-26 | Plan Mode 文档
> 紧接「NA 选项 + 成绩 Tab」之后的**体验层/刷新逻辑**改进。
> 核心原则：所有按钮点击必须有即时视觉反馈 + 移动端优先 + 无阻塞刷新。

***

## 一、Repo 探索结论

### 1.1 改动点精确定位

| # | 问题描述                                                                                        | 当前位置                                                                                                                                                                       |
| - | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | NA 按钮文案目前写「标记为不适用 (N/A)」 → 用户要求显示「Not Applicable（不适用）」                                      | [Learning.jsx:1439](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1439) 表单内；[L1673](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L1673) 待补填弹窗内 |
| 2 | 成绩 tab grade\_label 字段目前是纯 `<input type="text">`（自由输入），填写门槛高 → 改成**预设 chips 网格 + 自定义输入**二合一 | Learning.jsx 成绩 modal 分数/等第字段对（\~L1790-1818）                                                                                                                               |
| 3 | 成绩 modal 未针对移动端特别优化（触屏点击区域、键盘弹出版本安全区）                                                       | 同上，modal inner max-width 420、padding 16px 目前够但触屏触控目标 <44px                                                                                                                 |
| 4 | 待补填 badge 红色 → 改灰色（避免"紧急感"）                                                                 | [index.css:837-845](file:///Users/jefflau/projects/一表人才/src/index.css#L837-L845) `.seg-tab-badge` 目前 `background: var(--brand)` 红                                          |
| 5 | 进入记录页后切到「待补填」tab 才调用 loadPending()，导致 badge 数字在 tab 切换前不显示                                  | [Learning.jsx:343-346](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L343-L346) `if (user && view === 'pending') loadPending();`                              |
| 6 | 代填保存成功后只有 toast（右上角黑条），没有强烈的「已完成」视觉反馈 → 加居中 Liquid Glass ✓ 层                                | [Learning.jsx:811-836](file:///Users/jefflau/projects/一表人才/src/pages/Learning.jsx#L811-L836) `onSavePendingGrade`                                                          |
| 7 | 学生接受邀请后，老师端必须手动刷新才能看到连接状态变为「已连接」，缺少 realtime refresh                                        | [Mentor.jsx L125+](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx) 目前 Mentor 没有对 `teacher_student_connections` 的 realtime 订阅，Notifications.jsx 学生端**有**订阅可做参考    |
| 8 | 全局保存/删除按钮只有 disabled 灰态，没有 spinner / loading 视觉 → 点击后用户"觉得什么都没发生"                           | Learning.jsx `onSubmit` / `onSaveEdit` / `saveScore` / Notifications `updateStatus` / Mentor 所有 CRUD 按钮                                                                    |

### 1.2 相关现有基础设施（可复用）

| 资产                                             | 位置                                                                                                 | 作用                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Supabase realtime channel（参考）                  | [Notifications.jsx:27-40](file:///Users/jefflau/projects/一表人才/src/pages/Notifications.jsx#L27-L40) | `supabase.channel('public:teacher_student_connections')` 订阅模式，Mentor 端可以完全照搬（改 filter 为 `teacher_id=eq.${user.id}`） |
| `busy` / `pendingSaving` / `scoreSaving` state | Learning.jsx 多处                                                                                    | 已有 loading 状态变量，只差 UI 渲染 spinner                                                                                    |
| framer-motion + createPortal 居中 modal 模式       | Learning.jsx 代填 modal、成绩 modal                                                                     | 可直接复用做 Liquid Glass Checkmark overlay                                                                               |
| toast() lib                                    | `src/lib/toast.js`                                                                                 | 已有右上角黑条 toast，继续保留但不是唯一反馈机制                                                                                         |
| 等第 letter grade 预设                             | Learning.jsx `OBJECTIVE_STEPS` + 中文等第可以按学校常见约定扩展                                                   | 13 档 A+\~F + 常用 5 档中文（优/良/中/合格/不合格）                                                                                 |

***

## 二、具体改动清单

### 改动 1：NA 文案统一改为「Not Applicable（不适用）」

**文件**：Learning.jsx

修改 2 处按钮文字：

* 表单内（L1439）：`✓ Not Applicable（不适用）` / `Not Applicable（不适用）`

* 待补填弹窗内（L1673）：`Not Applicable（不适用）`

**内部 grade\_label 仍为** **`'N/A'`（不变）**——只有按钮显示文案改变，数据库存值、待补填过滤、列表显示都不触动，零风险。

***

### 改动 2：成绩 tab grade\_label 改 chips 预设网格 + 自定义输入（Effortless + Mobile-first）

**文件**：Learning.jsx（成绩 modal 内 grade\_label 字段段）

#### 2.1 预设等第常量（常量区新增）

```js
// 成绩 tab 预设等第（先给最常用 18 个；增删改这个数组即可，UI 自动渲染）
const GRADE_PRESET_CHIPS = [
  'A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F',
  '优秀','良好','中等','合格','不合格',
];
```

#### 2.2 UI 改造

原来的两列（分数 / 等第）：

**改前**：等第列 = `<input type="text" placeholder="如 A+、优、合格">`

**改后**：等第列 = 顶部 **4 列 chips 网格**（移动端每行 4 个，高度 ≥ 44px 适合手指）+ 底部「自定义」输入框：

```
┌─────────────────────────────────────────────────────┐
│  分数（0–100）     │   等第                          │
│  [ 92.5 ]          │   ┌────┐ ┌────┐ ┌────┐ ┌────┐ │
│                    │   │ A+ │ │ A  │ │ A- │ │ B+ │ │
│                    │   └────┘ └────┘ └────┘ └────┘ │
│                    │   ┌────┐ ┌────┐ ...   ┌────┐ │
│                    │   │ 优秀 ││ 良好│ ...  │不合格│ │
│                    │   └────┘ └────┘       └────┘ │
│                    │   [ 自定义输入… 可留空 ]         │
└─────────────────────────────────────────────────────┘
```

**交互**：

* 点任一 chip → `scoreForm.grade_label = chipText`，chip 高亮描边 `#0f172a`；点同一 chip 两次可取消。

* 手动输入自定义文字 → 所有 chips 自动取消高亮。

* 提交时优先取 grade\_label 文本值（无论来自 chip 还是自定义输入）。

**移动端优化**：

* 每个 chip 最小高度 44px（Apple HIG 推荐触控目标）、字体 13+ 粗。

* Modal `maxWidth: 420` → 移动端保留 `width:100%`，但 padding 用 `env(safe-area-inset-*)` 避免 iOS 底部安全区遮挡。

* input type=number 显示 iOS 数字键盘。

***

### 改动 3：seg-tab-badge 红色 → 灰色（#94a3b8）

**文件**：index.css L837-845

```css
.seg-tab-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  background: #94a3b8;        /* ← 原 var(--brand) 红 改成灰 */
  color: #ffffff;             /* 白字 */
  line-height: 1.5;
}
```

成绩 tab 的 badge（相同 className）自动变成灰色，无需额外处理。

***

### 改动 4：loadPending 进页面即刷新（tab badge 立即显示数字）

**文件**：Learning.jsx L343-346

**改前**：

```js
useEffect(() => {
  if (user && view === 'pending') loadPending();
}, [user, view]);
```

**改后**：

```js
// 进页面即加载 pending（tab bar badge 需要数字显示），同时 view==='pending' 时再次刷新
useEffect(() => {
  if (user) loadPending();
}, [user]); // eslint-disable-line
useEffect(() => {
  if (user && view === 'pending') loadPending();
}, [user, view]); // eslint-disable-line
```

同时，每次 `onSubmit` / `onSaveEdit` **保存成功后也刷新 pending**：

* onSubmit L453 之后 `await loadPending();`

* onSaveEdit 刷新 recent 之后也 `await loadPending();`

这样新增练习、保存/取消 NA、删除记录等行为都能立即反应在 badge 数字上，无需切 tab。

***

### 改动 5：代填成功后加 Liquid Glass ✓ 快速反馈

**文件**：Learning.jsx `onSavePendingGrade` + JSX 末尾

#### 5.1 新增成功动画 state

```js
const [pendingSuccessFlash, setPendingSuccessFlash] = useState(false);
```

#### 5.2 onSavePendingGrade 成功流程替换

**改前**：`toast('客观评价已保存', ...)` → `closeModal` → `loadPending`（\~1.2s 完成，只有右上角黑条）

**改后**：

```
1. setPendingSaving(true)  → 按钮"保存中…" spinner
2. Supabase update 成功
3. setPendingSuccessFlash(true) → 居中显示 Liquid Glass ✓
4. 同时调用 toast('客观评价已保存') → 保留右上角
5. 750ms 后同时执行：
   a. setPendingSuccessFlash(false)
   b. setPendingModalSession(null) / setPendingModalGrade(null)
   c. await loadPending()
6. setPendingSaving(false)
```

#### 5.3 Liquid Glass Checkmark overlay（createPortal + framer-motion）

样式规范：

* 居中 fixed overlay，`inset:0`，不阻止点击（`pointer-events: none`，只是视觉层）

* 玻璃本体：`background: rgba(255,255,255,0.72)` + `backdrop-filter: blur(20px)` + `border: 1px solid rgba(255,255,255,0.8)` + 阴影柔和

* 本体 108px × 108px 方形圆角 28px

* 内部 ✓ 使用 SVG 白色 + spring 描边动画（stroke-dashoffset 从 100→0，像 Apple iCloud 登录的 ✓ 动画）

* enter: scale 0.85→1 + opacity 0→1（spring 300/30）；exit: 反向 + 200ms

* 总展示时间 750ms（用户感知到"已完成"但不拖慢流程）

***

### 改动 6：Refresh 逻辑加固 + 全局按钮点击反馈

#### 6A. 师生连接 Realtime Refresh（Mentor 端）

**文件**：Mentor.jsx L125 之后新增 useEffect（与 Notifications.jsx 对称）

```js
// 监听 teacher_student_connections 的状态变更（学生接受/拒绝/断开时自动刷新）
useEffect(() => {
  if (!user) return;
  let cancelled = false;
  const subscription = supabase
    .channel('mentor-connections')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'teacher_student_connections',
      filter: `teacher_id=eq.${user.id}`,
    }, (payload) => {
      if (cancelled) return;
      // UPDATE: status 0→1 学生接受邀请； status 1→2 学生断开
      // INSERT: 目前只有学生端 subscribe 能收到（导师端发邀请是自己 insert，本地已乐观更新）
      // 最稳策略：只要收到与我有关的变更，就完整 reload connections 子集
      if (user) {
        loadData(user.id, isAdmin).then(() => {
          logger.log('mentor connections realtime refreshed by payload:', payload.eventType);
        }).catch(e => logger.error('realtime loadData failed', e));
      }
    })
    .subscribe();
  return () => {
    cancelled = true;
    supabase.removeChannel(subscription);
  };
}, [user]); // eslint-disable-line
```

**注意**：如果 `isAdmin` 的依赖会在后续变化，将其加进 deps；admin 目前是进入时确定的，所以没问题。

#### 6B. 全局按钮点击态：加 inline spinner

目前大量按钮的 busy 态只有 `disabled` + 变灰 + 文字变为"保存中…"，对移动端用户来说反馈太弱。

**规则**：所有 CRUD 操作按钮（至少以下列表）在 `busy` / `saving` / `pendingSaving` / `scoreSaving` / `busyId` 为 true 时：

* 文字左侧加一个 14px 的 inline spinner（SVG 圆环 border-radius 动画，不依赖 CSS keyframes，直接 framer-motion 循环 rotate 18deg/16ms 即可，或直接 class `.loading-spinner-inline`）

* Spinner 尺寸 14px，stroke 2px，颜色与按钮文字相同（白/黑灰）

改造范围（至少覆盖以下用户能"直接感觉不到变化"的按钮）：

| 文件                | 按钮                     | 当前 loading state                                             |
| ----------------- | ---------------------- | ------------------------------------------------------------ |
| Learning.jsx      | 保存记录 (onSubmit)        | busy                                                         |
| Learning.jsx      | 保存修改 (onSaveEdit)      | busy                                                         |
| Learning.jsx      | 确认删除 (onConfirmDelete) | busy                                                         |
| Learning.jsx      | 待补填 modal 保存客观评价       | pendingSaving                                                |
| Learning.jsx      | 成绩 modal 取消 + 保存成绩     | scoreSaving                                                  |
| Learning.jsx      | 成绩列表删除确认               | scoreDeletingId === s.id（已有确认态无 spinner → 确认按钮加 spinner 白红配） |
| Notifications.jsx | 接受 / 拒绝邀请              | busyId === id → btn 显示 spinner + 文字"处理中"                     |
| Mentor.jsx        | 发送邀请 / 撤回邀请 / 删除课程章节单元 | 各 CRUD 函数的 busy or inline state                              |

***

### 改动 7：成绩保存成功 + 学习记录保存成功 也加迷你 Liquid Glass 反馈

与改动 5 同一套组件复用，但因为是主页面内（非 modal），所以视觉可以稍小一点：

* 80px × 80px Glass square

* 成功时居中 flash 450ms，opacity 从 0→1→0 scale 0.9→1→1.05

* 仍保留右上角 toast 作为文字描述反馈

* 失败（catch 分支）：同样的 Glass 里面显示 ✗，红边 `#fee2e2`，但不阻止关闭

实现方式：把 `LiquidGlassCheckmark` 抽成文件内本地组件，3 个调用点共用：

1. 待补填 modal → 大尺寸（108px / 750ms）
2. 保存成绩成功 → 中尺寸（88px / 500ms）
3. onSubmit / onSaveEdit 成功 → 同中尺寸

***

## 三、文件清单与改动范围

| # | 文件                            | 改动类型 | 说明                                                                                                                                                                                                                                                  |
| - | ----------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `src/pages/Learning.jsx`      | 修改   | 改动 1（NA 文案 2 处）+ 改动 2（grade\_label chips 网格 + 移动端优化 + safe-area）+ 改动 4（loadPending 提前触发 + onSubmit/onSaveEdit 后刷新）+ 改动 5（Pending Success Liquid Glass overlay）+ 改动 7（saveScore/onSubmit/onSaveEdit 成功 overlay）+ 改动 6B（spinner inline busy 态 7+ 处按钮） |
| 2 | `src/index.css`               | 修改   | 改动 3（.seg-tab-badge 红→灰 #94a3b8）                                                                                                                                                                                                                    |
| 3 | `src/pages/Mentor.jsx`        | 修改   | 改动 6A（teacher\_student\_connections realtime subscription + 自动 loadData 刷新）+ 改动 6B（发送邀请/撤回/CRUD 按钮 inline spinner）                                                                                                                                  |
| 4 | `src/pages/Notifications.jsx` | 修改可选 | 改动 6B（接受/拒绝邀请按钮 inline spinner + "处理中…"）                                                                                                                                                                                                            |

**总文件**：4 个（3 必改 + 1 可选），0 新增文件（所有新组件 inline 在 Learning.jsx 内，避免拆文件太散）。

***

## 四、显式假设

1. **NA 按钮文案**：按钮显示 `Not Applicable（不适用）`，内部 grade\_label `'N/A'` 不变；标签页列表仍显示「客观：N/A」（短标签不影响）。如用户希望完全用英文或完全用中文，只需改 2 处按钮文字常量。
2. **成绩预设等第**：`GRADE_PRESET_CHIPS = [A+~F 13档 + 优秀/良好/中等/合格/不合格 5档]` 共 18 个；增删这个数组即可自动渲染更多/更少。
3. **Liquid Glass 设计**：白色半透明 + blur(20px) + 软阴影；不添加颜色评价（符合项目约束）。成功=灰边白勾，失败=红边白叉 ✓/✗ 不引入绿/红（严格遵循项目记忆中的中性黑灰）。
4. **Realtime 频道命名**：Mentor 端用 `'mentor-connections'`（与学生端 `'public:teacher_student_connections'` 分开），不冲突。
5. **Mentor reloadData 策略**：收到 realtime 事件后完整 `loadData(teacherId, admin)` 重拉；如果数据量大可以改成只重拉 connections 子集，但目前学生数量 ≤ 500 完全没问题。

***

## 五、风险与风险应对

| 风险                                                           | 应对                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Supabase realtime 未启用（Supabase project 默认需控制台开启 replication） | 如果 subscription 回调不触发，**不影响功能**——只是回到"手动刷新可见"旧行为；计划增加一条 console.error 提示用户在 Supabase Dashboard → Replication 打开表的 realtime |
| loadPending 提前触发 + onSubmit 后重刷 → 请求过多                       | 每次最多 1 条 SQL，limit 50；对 1 用户最多 100 rows/s，完全可接受                                                                            |
| Liquid Glass overlay createPortal 与现有 modal 同层 z-index 冲突    | `z-index: 1500`（比现有 1000 高），保证视觉最上层；`pointer-events: none` 不阻塞交互                                                           |
| inline spinner 与按钮文字布局溢出                                     | Flex 布局 gap:6px + spinner 14px，按钮高度足够；移动端测试需留意 iPhone SE (320px) 上是否换行                                                     |
| GRADE\_PRESET\_CHIPS 18 个 4 列网格 → 高度过高 + modal 需要滚动          | 现在的 modal body `overflowY: auto` + padding 已支持滚动；关键是保证"考试名称/日期/分数"在首屏无需滚动即可看到                                              |

***

## 六、验证清单

| #  | 验证点                                                                                    | 预期                  |
| -- | -------------------------------------------------------------------------------------- | ------------------- |
| 1  | 进 Learning 页面**不切 tab**，立即看到右上角待补填 badge 数字（如 >0）                                      | 不再需要切到「待补填」tab 才刷新  |
| 2  | 新增练习并选择"稍后补充"→ badge 数字 +1（无需切 tab 立刻看得到）                                              | OK                  |
| 3  | 代填 modal 保存 → 居中 Glass ✓ 闪现 (750ms) → modal 自动关闭 → badge 数字 -1 → toast 右上角 → 全部 smooth | OK                  |
| 4  | NA 按钮文案是 `Not Applicable（不适用）` → 点后 grade\_label='N/A'，记录列表显示「客观：N/A」                  | 存储/过滤不变             |
| 5  | 成绩 tab 新增 → modal 中「等第」显示 4 列 chips，点任何 chip → grade\_label 自动填充 + 自定义输入框同步显示          | OK                  |
| 6  | 成绩 tab 自定义等第输入后提交 → chips 自动取消高亮、值正确保存                                                 | OK                  |
| 7  | 移动端 iPhone SE/iPhone 12 mini：每个 chip ≥ 44px、手指不会误点相邻                                   | OK                  |
| 8  | 待补填 badge 颜色是灰色 `#94a3b8`（非红）                                                          | OK                  |
| 9  | 学生端 Notifications 接受邀请 → 打开 Mentor 端（无需刷新页面）→ 几秒内学生状态从「邀请中」变成「已连接」                     | realtime refresh 生效 |
| 10 | Mentor 发送邀请按钮 / Notifications 接受按钮 / Learning 保存成绩按钮 → busy 态有 spinner 而非单纯灰掉          | 用户感知"正在处理"          |
| 11 | 所有按钮点击 → 要么 spinner 转动 / 要么 Glass overlay / 要么 toast 弹出 → "没有任何事情发生"的场景不存在             | OK                  |
| 12 | `npx vite build` 通过                                                                    | 无构建错误               |

***

## 七、执行顺序

1. 先改 index.css（改 3 badge 颜色 → 1 分钟可回滚）
2. 改 Learning.jsx NA 文案 + loadPending 触发时机 + 保存后刷新 pending（改动 1+4）
3. 改 Learning.jsx 成绩 tab grade\_label chips + 移动端优化（改动 2）
4. 改 Learning.jsx 抽 LiquidGlassCheckmark 组件 + 三个成功反馈点 + inline spinner（改动 5+6B+7）
5. 改 Mentor.jsx realtime subscription + 按钮 spinner（改动 6A+6B）
6. 改 Notifications.jsx 接受/拒绝 spinner（改动 6B）
7. `npx vite build` 验证通过

