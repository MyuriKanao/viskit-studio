# Design Brief — AIShop Studio
*Paste this (or sections of it) into claude.ai/design*

---

## 一句话定位
A self-hosted creative workbench where e-commerce sellers forge a complete marketing kit — structured copy spec + 14 production-ready images + bestseller-driven aesthetic — from a single product photo, with a model-provider-agnostic AI backbone.

---

## 设计哲学 (Design Philosophy)

> **"工具应该消失，让生成内容呼吸。UI 是画框，作品是画。"**

这不是又一个 SaaS dashboard。它是给中小卖家/品牌主理人/跨境运营的**桌面级创意工具**，气质应该接近：

- **Linear** 的信息密度与工艺感
- **Arc Browser** 的个性与玩心
- **Krea.ai / Pika** 的"生成工具基因"
- **Loom** 的温度

不要：generic SaaS 仪表盘的"专业可靠感"。要：创意工作室的"作品级精致感"。

---

## Visual Language

### Mood
Editorial minimalism × soft glassmorphism touches × warm-tinted neutrals × monospaced flourishes (for prompts/config). Dark mode 为主，优雅 light mode 为辅。

### Color Tokens

```css
/* === DARK (primary) === */
--ink-base:        #0A0908;   /* 深墨底 */
--surface-01:      #15110F;   /* 卡片底 */
--surface-02:      #1F1A16;   /* 抬升层 */
--surface-glass:   rgba(31, 26, 22, 0.6);  /* glass */
--border-subtle:   #2A211C;
--border-strong:   #3D3027;
--text-primary:    #F0E8DD;
--text-muted:      #948A7E;
--text-faint:      #5C544B;

/* Brand accent — 古铜红 (Hermès-ish), 沉稳不浮夸 */
--accent:          #C4513A;
--accent-soft:     #D97757;
--accent-glow:     rgba(196, 81, 58, 0.18);

/* Semantic */
--success:         #6B8E5A;   /* 沉橄榄 */
--warning:         #C4924A;   /* 蜂蜜金 */
--danger:          #A23E2F;
--info:            #4A6F8E;

/* === LIGHT === */
--ink-base-l:      #FAF8F5;   /* 米浮白 */
--surface-01-l:    #F1ECE5;
--surface-02-l:    #E8E1D6;
--border-l:        #D6CBBC;
--text-primary-l:  #1A1411;
```

### Typography Pairing

| Role | English | 中文 |
|------|---------|------|
| Display / Headlines | **Instrument Serif** (italic for hero) | **思源宋体 / Source Han Serif** |
| Body / UI | **Inter** (var) | **PingFang SC / 思源黑体** |
| Mono (prompts/config) | **JetBrains Mono** | (same) |
| Numerals (KPI) | **Instrument Serif** italic | — |

衬线大标题 + 极克制的无衬线 UI = 创意工具应有的"作品感 + 工程感"对位。

### Spatial System
- Base 8px, but breathe at **24 / 32 / 48 / 64**
- Radius: **12px** standard / **20px** cards / **4px** inputs / **999px** pill CTA
- Shadow: 只在 hover / floating dock 出现，颜色 `rgba(0,0,0,0.4)` blur 24px

### Motion
- Easing: `cubic-bezier(0.4, 0, 0.2, 1)`, default 240ms
- Image grid: fade-in **stagger 80ms**
- Modal: lift + backdrop `backdrop-filter: blur(20px)`
- Compliance ring: spring (stiffness 150, damping 18)
- "Generating" state: subtle shimmer + 1° hue rotate loop

### 信息层级权重
1. **生成内容**（图、文案）≈ 70% 视觉权重
2. **工具控件** ≈ 25%
3. **系统色**（导航、状态）≈ 5%

---

## 必备界面 / 11 Screens

### 0. Global Shell
- 左侧 **240px 导航**：Logo(衬线字 *AIShop Studio*) → Catalog / New Kit / Queue / Bestseller Vault / Templates / Providers / Settings
- 顶部右上：locale 切换(中/EN)、theme toggle、当前 provider 状态指示灯、user avatar
- 主区域 padding: 32px

### 1. Dashboard — 首页
3 段式：
- **Hero strip**：4 个 KPI 卡片（本周生成套包 / 平均合规分 / 人工修字均时 / API 成本累计）。每个卡片左下角 micro sparkline。数值用 Instrument Serif italic。
- **Recent Kits**：3-col 瀑布流。每卡 = 14 图拼贴预览 + SKU + 状态 chip + 合规圆环 + locale flag。Hover lift。
- **Queue at a glance**：横向条带，显示当前批量任务进度。

### 2. Catalog — 商品库
- 顶部 quick filter chips（类目 / locale / 状态 / 合规分阈值）+ 视图切换（grid/table）+ 排序
- 表格 columns: cover thumb / SKU / 名称 / 类目 / 状态 / 合规分 / 最近更新 / 行内操作
- 右上 CTA `+ New Kit`（古铜红 pill）
- Row hover 显示 inline actions（regenerate / edit / export zip / delete）

### 3. New Kit — 创建向导 (single-page, 4 steps)
绝不用 modal，要单页 step-flow（左侧 step rail + 右侧主区域）。
- **Step 1 「Drop product photo」**：全屏 dashed dropzone，居中提示 *拖入或粘贴产品图*，呼吸边框。
- **Step 2 「Tell me about it」**：双列。左 = metadata 表单（SKU/name/category/price/brand/locale）。右 = 选中图预览 + AI 自动识别的属性 chips（each with confidence bar）。
- **Step 3 「Pick aesthetic anchor」**：触发 Milvus 检索，展示 top-9 爆款参考缩略图（带销量徽章），用户可点选/反选/查看大图。
- **Step 4 「Confirm & forge」**：摘要 + 预估时间 + 预估成本 + big CTA *Forge Kit* (古铜红 pill, with subtle pulse)。

### 4. Kit Detail — 套包详情 ★（核心）
**最重要的一页，design budget 重点投放**。
- **Sticky top header**：左 SKU 信息 + locale flag，中 status chip，右 合规圆环（点击展开 inspector） + 操作按钮组（regenerate kit / export zip / open editor）
- **左 1/3 column**：spec.md 渲染，markdown 风格但带:
  - 5 主图 + M1–M9 详情每块的锚点 nav
  - 三件套结构 (画面 / 图内文案 / 设计说明) 用 inline tabs 区分
  - 右侧浮动 mini-TOC（粘性）
- **右 2/3 column**：**14 图 masonry grid**
  - 上排 5 张 hero (1:1)
  - 下排 9 张 detail (2:3)
  - 每张图 hover 浮现 toolbar: `↻ regen` `✎ edit text` `</> prompt` `⇄ variants`
  - 「Brand color locked」徽章（含 hex 取色块）在 grid 右上角
- **Bottom floating dock**：3 个可展开 inspector — *Compliance breakdown / Provider trace / Cost breakdown*。Glass blur 20px。

### 5. Image Editor — 单图修字 (fullscreen modal)
- 90% 区域大图，可缩放/平移
- 右侧 **320px tool rail**：
  - "Text layers detected" 列表，AI 检测到的图内文字 box，点击高亮 + 弹出 inline 编辑替换框
  - 「Inpaint」按钮一键重出文字
  - 字体/字号/颜色微调
  - 历史版本时间线
- 底部 strip：同 kit 其他图横向缩略图，可一键跳转
- 顶部：`⌘+S` 保存 / `ESC` 退出 / `⌫ Discard`

### 6. Bestseller Vault — 爆款语料库
- 顶部 search bar + 类目/季节/销量阈值滑块 + 「+ Ingest CSV」
- Masonry grid。每张图 hover 显示销量数字、类目、relative similarity heat（仅在检索回流时显示）
- 右侧可滑出 detail drawer：完整记录字段、向量空间相似品、批量打 tag、标记为"灵感库"
- 顶部统计 strip："Indexed: 1,247 SKUs | Vectors: 1,247 dense + sparse | Last sync: 12 min ago"

### 7. Templates — 模板库
25 模板 grid。每张卡：
- 模板预览（示例生成图，gray-out 状态待选中亮起）
- 模板名 + 标签 chips（淘宝主图 / Amazon Hero / 抖店直播 / 详情 M3 ...）
- 「Use in next kit」CTA
- 右上 `★` 收藏

### 8. Providers — 模型路由 (★ 抽象层可视化)
**这一页是 spec 里 Round 7 的灵魂**。
- 顶部双列 sections：「**OPENAI-compatible Endpoints**」「**ANTHROPIC-compatible Endpoints**」
- 每个 section 列出已接入的端点卡片：`base_url` + 已分配的 role badges + 「Test」按钮 + 延迟 ms 显示
- 中间 **Active Routing Sankey** 图：5 个 role 节点 (vision / llm / image_gen / image_edit / embedding) → 用细线流向各端点，颜色按协议族区分
- 底部 toggle：可视化编辑 ↔ YAML 源码（mono font, syntax highlight）
- 「+ Add Endpoint」打开 modal：protocol 选择 → base_url → api_key → model_id → test → save

### 9. Queue — 批量队列
- 顶部 throttle 控制：并发数 slider、API 速率 limit
- 主区域横向时间线 + 任务卡瀑布。每卡：
  - 缩略图 + SKU + locale
  - 阶段进度条：`retrieve → style → generate → score → done`，每阶段一个小段
  - 预计剩余 + 当前阶段消耗
  - 暂停/取消 inline buttons
- 完成的任务沉底，进行中的任务置顶

### 10. Settings
单页 sections：Profile / Workspace path / Storage (local / MinIO) / Auth (local password) / Logs viewer / About。极简 list-form。

---

## 组件清单 (custom shadcn/ui)

```
KitCard              — 套包卡片，含 14 图拼贴 + 合规圆环
ComplianceRing       — 圆环 0–100，gradient #A23E2F → #C4924A → #6B8E5A
ImageGrid            — masonry，支持 brand-color-lock 徽章
DropZone             — full-screen variant 带呼吸边框
ProviderRoleBadge    — 显示 protocol + role 的双层 chip
StatusChip           — queued/generating/ready/needs_review/failed (5 色)
BestsellerThumb      — 缩略图 + 销量徽章 + similarity heat
PromptInspector      — 折叠面板，mono font，token highlight
TextLayerOverlay     — 图上 hover 高亮 OCR 检测到的文字 box
StepWizardNav        — 向导步骤进度
SankeyRouting        — Providers 页的 role-to-endpoint 流向图
KpiCard              — Instrument Serif italic 数字 + sparkline
```

---

## 微动效

- **图片生成中**：卡片 shimmer 横扫 + 1° hue rotate loop
- **生成完成**：卡片 lift + 古铜红 ring 短促亮起 + 可选 chime
- **Brand color lock 加载**：14 张图按 stagger 80ms 依次显示同色 ring
- **Compliance ring 分数变化**：spring 动画 (stiffness 150, damping 18)
- **DropZone hover**：dashed border 呼吸 + 接近边缘时换色
- **Sidebar item hover**：左侧 2px 古铜红条 fade-in
- **Provider 端点 test**：按钮 → 转 loading dot → 替换为延迟 chip

---

## 边界感 / 严格禁止

- ❌ Generic SaaS 仪表盘的"3-column metric + tree sidebar"
- ❌ 任何花哨渐变背景（除非来自图片自身）
- ❌ Emoji 装饰（只允许在 status chip 上极简使用，且每态最多 1 个）
- ❌ Stock illustration / 3D 玩偶 / 卡通形象
- ❌ Apple "lickable" 拟物或拟纸
- ❌ Logo 用中英混杂拼贴
- ❌ 通知气泡用红色圆点（用古铜红方点）

---

## 输出要求 (for claude.ai/design)

- **11 个完整 page**（dashboard / catalog / new-kit / kit-detail / image-editor / bestseller-vault / templates / providers / queue / settings + global shell）
- **响应式**：desktop ≥1280px (primary) + tablet ≥1024px (graceful)
- **Stack**：Next.js 14 App Router + Tailwind + shadcn/ui
- **配色**：上方 token 写成 CSS variables，dark mode 默认，附 light mode toggle
- **i18n**：界面文案中文，可一键切英文（关键 label 都备双语）
- **真实 placeholder**：所有 SKU 用真实跨境/淘宝品类命名（如「云感针织开衫 NEW001 / Bohemian Pink Midi Dress SKU042 / 玻尿酸精华水 SKU017」），不要 Lorem
- **至少 1 页** (Kit Detail) 包含完整 14 图 mock grid（用 Unsplash 服饰图或 placeholder.com）
- **Providers 页**必须有可视化的 Sankey routing 图

---

## 一个 reference shot 想象图

> 想象一下打开 *Kit Detail* 页面的瞬间：
>
> 顶部 sticky header 是深墨底，左边写着「云感针织开衫 · NEW001 · 中文/CN」用思源宋体，右边一颗古铜红的合规圆环静静转出 92 分。
>
> 左侧 column 是 markdown 长文，spec 一行行展开，三件套 (画面/图内文案/设计说明) 用 inline tab 优雅区分，每个标题前有衬线编号 *M1·M2·M3*。
>
> 右侧 column 是 14 张图 stagger fade-in：5 张 1:1 主图在上排，9 张 2:3 详情图在下排，每张图右上角都有一个 #C4513A 圆点暗示 brand color locked，整页空气感拉满。
>
> 你下意识想点其中一张主图 → toolbar 浮现，灰底毛玻璃，4 颗操作按钮，刚刚好。
>
> 这就是 *AIShop Studio*。
