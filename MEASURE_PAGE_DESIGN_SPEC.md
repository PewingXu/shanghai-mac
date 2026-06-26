# 测量页（MeasurePage）右侧数据面板 — 设计规范文档

> 本文档描述「动态足底压力解析系统」测量页右侧数据面板的完整 CSS 设计规范，供 AI 开发者复现或二次开发使用。

---

## 一、整体页面布局

页面采用**左右分栏**布局，左侧为 3D 足底模型区域（`flex: 1`），右侧为数据面板（固定宽度 `420px`）。

```css
/* 页面主体容器 */
main {
  flex: 1;
  display: flex;
  flex-direction: row;
  padding: 24px 32px 80px;
  gap: 24px;
  margin-top: 72px; /* 为顶部导航栏留空 */
}

/* 右侧数据面板 */
.right-panel {
  width: 420px;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
```

---

## 二、页面背景色

整体背景为**暖米色渐变**，营造温暖、医疗专业感：

```css
body / page-bg {
  background: linear-gradient(135deg, #fdf5d8 0%, #faecd0 50%, #f5e0c0 100%);
}
```

---

## 三、分组标题样式

每个数据组（受压面积 / 压力）上方有中英文双语标题：

```css
/* 中文主标题 */
.section-title-zh {
  font-size: 16px;
  font-weight: 700;
  color: #5A3A1A;
}

/* 英文副标题 */
.section-title-en {
  font-size: 12px;
  color: #8A6A40;
  margin-left: 10px;
}
```

---

## 四、大数据卡片（DataCard）— 实时面积 / 实时压力

这是最显眼的卡片，顶部显示标签和数值，底部有橙色波浪装饰。

### 4.1 卡片容器

```css
.data-card {
  background: rgba(255, 255, 255, 0.82);
  border-radius: 12px;
  padding: 14px 18px 0;   /* 底部 padding=0，让波浪紧贴底边 */
  overflow: hidden;
  box-shadow: 0 1px 8px rgba(200, 120, 0, 0.08);
  display: flex;
  flex-direction: column;
}
```

### 4.2 卡片内容行（标签 + 数值）

```css
.data-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

/* 左侧标签 */
.data-card-label {
  font-size: 13px;
  color: #8A6A40;
}

/* 右侧数值（粗体大字） */
.data-card-value {
  font-size: 18px;
  font-weight: 700;
  color: #3A2A10;
}

/* 单位（跟在数值后，字号小一些） */
.data-card-unit {
  font-size: 13px;
  font-weight: 500;
}
```

### 4.3 底部波浪装饰（SVG）

用 SVG 路径画两层半透明橙色波浪，紧贴卡片底部：

```jsx
// React JSX 写法
function WaveDecor() {
  return (
    <svg
      viewBox="0 0 300 40"
      preserveAspectRatio="none"
      style={{ width: "100%", height: "40px", display: "block" }}
    >
      {/* 第一层波浪，透明度 18% */}
      <path
        d="M0 20 Q37.5 5 75 20 Q112.5 35 150 20 Q187.5 5 225 20 Q262.5 35 300 20 L300 40 L0 40 Z"
        fill="#F5A623"
        opacity="0.18"
      />
      {/* 第二层波浪，透明度 12%，错开相位 */}
      <path
        d="M0 25 Q37.5 10 75 25 Q112.5 40 150 25 Q187.5 10 225 25 Q262.5 40 300 25 L300 40 L0 40 Z"
        fill="#F5A623"
        opacity="0.12"
      />
    </svg>
  );
}
```

> **关键点**：卡片容器设置 `overflow: hidden` + 底部 `padding: 0`，波浪 SVG 用 `preserveAspectRatio="none"` 拉伸填满宽度，形成无缝贴底效果。

---

## 五、小统计卡片（SmallStatCard）— 平均/峰值/总值

三张小卡片横向排列，每张 `flex: 1` 等宽。

```css
.small-stat-card {
  /* 渐变背景：上半白色，下半浅橙 */
  background: linear-gradient(180deg, #ffffff 50%, #fff7ea 100%);
  border-radius: 12px;
  padding: 12px 14px;
  flex: 1;
  text-align: center;

  /* 橙色边框 */
  border: 1px solid #FFBF7B;

  /* 暖色阴影 */
  box-shadow: 0px 2px 6px 0px rgba(220, 185, 146, 0.4);
}

/* 数值行 */
.small-stat-value {
  font-size: 15px;
  font-weight: 700;
  color: #3A2A10;
}

/* 单位（内联，字号更小） */
.small-stat-unit {
  font-size: 11px;
  font-weight: 500;
}

/* 标签行 */
.small-stat-label {
  font-size: 11px;
  color: #8A6A40;
  margin-top: 2px;
}
```

---

## 六、控制按钮组（2D/3D、缩放、调参）

按钮组竖向排列，悬浮在模型右侧。

```css
.control-btn {
  width: 46px;
  height: 46px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  transition: all 0.15s;
}

/* 默认态（未激活） */
.control-btn-default {
  background: #FFF4E8;
  border: 1px solid #F79831;
  color: #F5A623;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
}

/* 激活态（如当前是 3D 模式时，3D 按钮高亮） */
.control-btn-active {
  background: #F5A623;
  border: 1px solid #F5A623;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(245, 166, 35, 0.30);
}
```

---

## 七、采集按钮（环形进度条）

### 7.1 外层容器

```css
.collect-btn-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
  padding-bottom: 8px;
}

.collect-btn-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
```

### 7.2 SVG 环形进度圈

核心参数：
- SVG 尺寸：`88×88`
- 圆心：`cx=44, cy=44`
- 半径：`r=36`
- 圆周长：`2π×36 ≈ 226.2`
- 底环弧度：270°（占圆周 75%），缺口在底部正中
- 旋转偏移：`rotate(135deg)`，使弧线从左下角顺时针开始填充

```css
/* SVG 整体旋转，使缺口朝下 */
.progress-svg {
  transform: rotate(135deg);
}

/* 采集中：脉冲发光动画 */
@keyframes pulse-glow {
  0%   { filter: drop-shadow(0 0 0px rgba(245, 166, 35, 0.6)); }
  50%  { filter: drop-shadow(0 0 8px rgba(245, 166, 35, 0.8)); }
  100% { filter: drop-shadow(0 0 0px rgba(245, 166, 35, 0.6)); }
}
.progress-svg-pulsing {
  animation: pulse-glow 1.6s ease-in-out infinite;
}
```

```jsx
// 关键 SVG 元素
const RADIUS = 36;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 226.2
const ARC_RATIO = 0.75;  // 270°
const ARC_LEN = CIRCUMFERENCE * ARC_RATIO;
const GAP_LEN = CIRCUMFERENCE * (1 - ARC_RATIO);

// 底环（灰色轨道）
<circle
  cx="44" cy="44" r={RADIUS}
  fill="none"
  stroke="rgba(180,160,130,0.35)"  /* 未开始时灰色 */
  strokeWidth="7"
  strokeLinecap="round"
  strokeDasharray={`${ARC_LEN} ${GAP_LEN}`}
  strokeDashoffset="0"
/>

// 进度弧（橙色，由 RAF 驱动直接操作 DOM）
<circle
  ref={progressArcRef}
  cx="44" cy="44" r={RADIUS}
  fill="none"
  stroke="#F5A623"
  strokeWidth="7"
  strokeLinecap="round"
  strokeDasharray={`0 ${CIRCUMFERENCE}`}  /* 初始为0 */
  strokeDashoffset="0"
/>

// 中心圆（按钮背景）
<circle
  cx="44" cy="44" r="26"
  fill="rgba(200,180,150,0.5)"  /* 未激活灰色 / 激活橙色 #F5A623 */
/>

// 中心方形图标（反向旋转抵消外层旋转）
<rect
  x="36" y="36" width="16" height="16" rx="4"
  fill="rgba(150,120,80,0.8)"  /* 未激活 / 激活白色 */
  transform="rotate(-135 44 44)"
/>
```

### 7.3 进度条动画实现（RAF 直接操作 DOM）

> **重要**：不要用 React state 驱动 `strokeDasharray`，会因 re-render 延迟导致卡顿。应用 `useRef` + `requestAnimationFrame` 直接操作 SVG DOM 属性。

```typescript
const progressArcRef = useRef<SVGCircleElement>(null);
const labelRef = useRef<HTMLSpanElement>(null);
const startTimeRef = useRef<number | null>(null);
const rafRef = useRef<number | null>(null);
const TOTAL_DURATION = 30; // 30秒

function startRAF() {
  startTimeRef.current = performance.now();
  function tick(now: number) {
    const elapsed = (now - startTimeRef.current!) / 1000;
    const p = Math.min(elapsed / TOTAL_DURATION, 1);

    // 直接操作 SVG 属性，无 React re-render
    if (progressArcRef.current) {
      const len = ARC_LEN * p;
      progressArcRef.current.setAttribute(
        "stroke-dasharray",
        `${len} ${CIRCUMFERENCE - len}`
      );
    }

    // 直接更新倒计时文字
    if (labelRef.current) {
      const remain = Math.max(0, Math.ceil(TOTAL_DURATION * (1 - p)));
      labelRef.current.textContent = `测量倒计时 ${String(remain).padStart(2, "0")}s`;
    }

    if (p < 1) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      // 采集完成
      labelRef.current!.textContent = "测量完成 00s";
      // 触发下一步逻辑...
    }
  }
  rafRef.current = requestAnimationFrame(tick);
}
```

---

## 八、底部操作栏

固定在页面底部，毛玻璃效果：

```css
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 40px;
  display: flex;
  align-items: center;

  /* 半透明暖米色背景 + 毛玻璃 */
  background: rgba(253, 245, 216, 0.88);
  backdrop-filter: blur(8px);

  /* 顶部橙色细线 */
  border-top: 1px solid rgba(245, 166, 35, 0.18);

  z-index: 20;
}
```

---

## 九、颜色系统总览

| 用途 | 颜色值 |
|------|--------|
| 主橙色（品牌色） | `#F5A623` |
| 橙色边框 | `#F79831` / `#FFBF7B` |
| 深棕文字（标题） | `#5A3A1A` |
| 深棕文字（数值） | `#3A2A10` |
| 中棕文字（标签） | `#8A6A40` |
| 卡片背景 | `rgba(255,255,255,0.82)` |
| 小卡片渐变 | `linear-gradient(180deg, #ffffff 50%, #fff7ea 100%)` |
| 页面背景渐变 | `linear-gradient(135deg, #fdf5d8, #faecd0, #f5e0c0)` |
| 卡片阴影 | `0 2px 6px rgba(220,185,146,0.4)` |
| 设备连接绿色 | `#27AE60` |

---

## 十、字体规范

| 层级 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 页面主标题 | 18px | 700 | `#5A3A1A` |
| 分组标题（中文） | 16px | 700 | `#5A3A1A` |
| 分组标题（英文） | 12px | 400 | `#8A6A40` |
| 大数据卡片数值 | 18px | 700 | `#3A2A10` |
| 大数据卡片标签 | 13px | 400 | `#8A6A40` |
| 小统计卡片数值 | 15px | 700 | `#3A2A10` |
| 小统计卡片标签 | 11px | 400 | `#8A6A40` |
| 底部操作栏文字 | 12~13px | 400~600 | `#8A6A40` / `#5A3A1A` |

---

## 十一、数据结构（供对接真实硬件数据参考）

```typescript
// 受压面积数据
interface AreaData {
  realtime: number;  // 实时面积 cm²
  avg: number;       // 平均面积 cm²
  peak: number;      // 峰值面积 cm²
  total: number;     // 面积总值 cm²
}

// 压力数据
interface PressureData {
  realtime: number;  // 实时压力 pa
  avg: number;       // 平均压力 pa
  peak: number;      // 峰值压力 pa
  total: number;     // 压力总值 pa
}
```

---

*文档生成时间：2026-06-25 | 项目：动态足底压力解析系统 ACIKI*
