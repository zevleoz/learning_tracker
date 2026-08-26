# 导师端新增「课表」Tab — 查看学生 Syllabus

## 摘要

在导师端（Mentor.jsx + MentorLayout.jsx）新增第 4 个 tab「课表」，让导师能查看指定学生的完整 syllabus（课程 → 章节 → 单元），只读模式。

***

## 当前状态分析

### 现有 Tab 结构

* **桌面端** ([MentorLayout.jsx:50-54](file:///Users/jefflau/projects/一表人才/src/components/MentorLayout.jsx#L50-L54))：`MENU_ITEMS` 数组定义 3 个 tab，通过 `onViewChange` 切换 `activeView`

* **移动端** ([Mentor.jsx:1094-1113](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L1094-L1113))：硬编码 3 个 `<button>`，用 `setActiveView('xxx')` 切换

* **内容渲染** ([Mentor.jsx:496-1082](file:///Users/jefflau/projects/一表人才/src/pages/Mentor.jsx#L496-L1082))：每个 `activeView === 'xxx'` 对应一个内容块

### Syllabus 数据加载模式

* 学生端 ([Syllabus.jsx:49-73](file:///Users/jefflau/projects/一表人才/src/pages/Syllabus.jsx#L49-L73))：通过 `supabase.from('courses').select('..., chapters:chapters(..., units:units(...))')` 嵌套查询加载课程树，用 `.is('deleted_at', null)` 过滤已删除项

* 导师端已有 `picked` 学生和 `students` 列表，可在「课表」tab 复用现有学生选择器

### RLS 权限

* `courses` 表的 select 策略已允许导师查看（通过 `is_mentor()` 或同校）

* 需确认：导师能否查看**其他学校**已连接学生的课程？当前 RLS 按学校维度过滤，但已连接学生可能跨校

***

## 改动方案

### 改动 1：MentorLayout.jsx — 添加「课表」tab 项

**文件**: `src/components/MentorLayout.jsx`
**位置**: L50-54 `MENU_ITEMS` 数组
**操作**: 在 `analytics` 和 `settings` 之间插入一项 `{ id: 'syllabus', label: '课表', Icon: IconBook }`，并新增 `IconBook` 图标组件（书本图标）

```jsx
// 新增 IconBook 图标
function IconBook() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

// MENU_ITEMS 新增
const MENU_ITEMS = [
  { id: 'students', label: '学生管理', Icon: IconUsers },
  { id: 'analytics', label: '数据分析', Icon: IconChartBar },
  { id: 'syllabus', label: '课表', Icon: IconBook },    // ← 新增
  { id: 'settings', label: '系统设置', Icon: IconSettings },
];
```

### 改动 2：Mentor.jsx — 添加「课表」内容渲染（桌面端）

**文件**: `src/pages/Mentor.jsx`
**位置**: 在 `activeView === 'analytics'` 块之后、`activeView === 'settings'` 块之前插入
**操作**: 新增 `activeView === 'syllabus'` 内容块

**内容结构**:

1. 页面标题「课表」+ 副标题「查看学生的课程大纲」
2. 学生选择器（复用 analytics tab 的下拉样式）
3. 选中学生后，加载该学生的 courses → chapters → units 嵌套数据
4. 以只读树形结构展示：课程名（学科标签）→ 章节列表 → 单元列表
5. 空态提示

**数据加载**: 用 `useEffect` 监听 `picked?.id` 变化，通过 `supabase.from('courses').select('id, name, subject, source, course_type, created_by, chapters:chapters(id, name, order_idx, units:units(id, name, order_idx))').is('deleted_at', null).eq('created_by', picked.id)` 查询该学生创建的课程

**UI 样式**:

* 每个课程一张白色卡片（圆角 16px，border #f1f5f9）

* 卡片头部：课程名（14px 700 #0f172a）+ 学科标签（11px #94a3b8）

* 章节列表：缩进显示，每行一个章节名（13px 600 #0f172a），下面再缩进显示单元

* 单元列表：每行前面加一个小圆点，字号 12px #64748b

* 颜色统一使用黑灰中性色（#0f172a / #94a3b8），与数据分析页风格一致

### 改动 3：Mentor.jsx — 添加移动端「课表」tab 按钮

**文件**: `src/pages/Mentor.jsx`
**位置**: L1094-1113 移动端 tab 导航
**操作**: 在「数据分析」和「设置」之间插入一个「课表」按钮

```jsx
<button
  onClick={() => setActiveView('syllabus')}
  className={`m-mentor-tab ${activeView === 'syllabus' ? 'm-mentor-tab-active' : ''}`}
>
  课表
</button>
```

### 改动 4：Mentor.jsx — 添加移动端「课表」内容渲染

**文件**: `src/pages/Mentor.jsx`
**位置**: 移动端内容渲染区域（在 `activeView === 'analytics'` 后）
**操作**: 新增 `activeView === 'syllabus'` 的移动端内容块
**说明**: 复用桌面端的数据加载逻辑和卡片样式，适配移动端宽度

### 改动 5：抽取 syllabus 数据加载 state

**文件**: `src/pages/Mentor.jsx`
**位置**: 组件顶部 state 定义区
**操作**: 新增 `syllabusCourses` state 和 `syllabusLoading` state，用 `useEffect` 监听 `picked?.id` 变化时加载

***

## 不改动项

* **Syllabus.jsx 学生端**: 学生端的 syllabus 编辑功能不变

* **RLS 策略**: 现有策略已允许导师查看课程数据，无需修改

* **数据库 schema**: 无需变更

***

## 验证步骤

1. `npm run build` 通过
2. 导师端桌面端：切换到「课表」tab，选择学生，确认课程树展示正常
3. 导师端移动端：切换到「课表」tab，确认布局适配
4. 空态：未选学生时显示提示
5. 切换学生后数据刷新

