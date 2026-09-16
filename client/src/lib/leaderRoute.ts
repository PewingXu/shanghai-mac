/**
 * 「定制对比」标注引线的路由（纯 2D 几何，不依赖 DOM / three）。
 *
 * 形状被用户逐轮收紧到最后只剩一种：**竖一段 + 横一段**，也就是恰好一个 90° 折角
 * （「折线角度都要 90 度」＋「折一次就好」）。横的那段平着扎进卡片，与设计稿的箭头一致；
 * 锚点纵坐标正好落在卡片高度内时竖段长度为 0，退化成一条直线。
 *
 * 于是唯一还能优化的自由度是【落点在卡片近边上的高度】：
 * 卡片钉死不动，但引线接在近边的哪个高度可以挑。按
 * 【总长 + OVER_W × 压在模型上的长度】穷举几个候选高度取最小 ——
 * 横段贴着鞋垫上/下沿走时，压在垫子上的长度能比「平着从锚点直接切出去」短一大截。
 *
 * ⚠ 一次折角的代价：引线**没法再绕开鞋垫**。前一版允许多个折角时，路由能沿凸包
 * 绕到模型外面走，压在垫子上的只剩锚点出界那一小截；只折一次的话，横段必须从锚点
 * 所在的高度（或候选高度）一路切到屏幕边上，穿过多少垫子由机位决定，只能取最短的那条。
 * 这是用户明确要的取舍，别再"顺手"把多折角加回来。
 *
 * 为什么障碍物用凸包而不是包围盒：鞋垫在屏幕上多半是斜的，包围盒会把左上/右下两大片
 * 空白也算成模型，候选高度全被判成一样差。鞋垫的投影轮廓本身近似凸，凸包 ≈ 轮廓。
 * 为什么不用真轮廓：要么每帧回读深度图、要么在 CPU 上做轮廓提取，
 * 代价与这点收益完全不成比例。
 *
 * 点一律用扁平 [x,y,x,y,…] 传：这些函数在 useFrame 里每帧调，别造几十个 {x,y}。
 */

/** 凸包外扩量(px)：引线拐点落在外扩后的包上，于是拐点离模型边缘还有这么多余量 */
export const HULL_CLEAR = 14;

/** 折线拐点写在这里（xs/ys 复用，有效点数 n） */
export interface LeaderPath {
  xs: number[];
  ys: number[];
  n: number;
}

export function makeLeaderPath(): LeaderPath {
  return { xs: [], ys: [], n: 0 };
}

// ─── 凸包 ────────────────────────────────────────────────────────────────────

/**
 * Andrew 单调链求凸包。out 写扁平顶点、返回顶点数。
 * 输出的绕向不保证（屏幕 y 朝下，链的方向随实现），所以下面所有「内外侧」判断
 * 都靠质心决定，不靠绕向 —— 绕向一变就静默出错，那种 bug 很难查。
 */
export function convexHull(src: number[], n: number, out: number[]): number {
  if (n < 3) {
    for (let i = 0; i < n * 2; i++) out[i] = src[i];
    return n;
  }
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => src[a * 2] - src[b * 2] || src[a * 2 + 1] - src[b * 2 + 1]);

  const cross = (o: number, a: number, b: number) =>
    (src[a * 2] - src[o * 2]) * (src[b * 2 + 1] - src[o * 2 + 1]) -
    (src[a * 2 + 1] - src[o * 2 + 1]) * (src[b * 2] - src[o * 2]);

  const lower: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }

  // 两条链各去掉末点（与另一条的首点重合）
  let m = 0;
  const take = (chain: number[]) => {
    for (let k = 0; k < chain.length - 1; k++) {
      out[m * 2] = src[chain[k] * 2];
      out[m * 2 + 1] = src[chain[k] * 2 + 1];
      m++;
    }
  };
  take(lower);
  take(upper);
  return m >= 3 ? m : 0; // 退化成一条线/一个点：当作没有障碍物，直线连过去
}

/**
 * 凸包沿「质心 → 顶点」方向整体外扩 clear 像素，原地改。
 * 用径向近似而不是严格的边法线外扩+求交：引线只要「不压在模型上」的余量，
 * 径向版在斜角处会欠 clear·(1−cosθ)（最坏约 30%，也就是 4px），够用；
 * 严格版要多一套边求交与 miter 截断，收益只有几个像素。
 */
export function expandHull(hull: number[], m: number, clear: number): void {
  if (m < 3) return;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < m; i++) {
    cx += hull[i * 2];
    cy += hull[i * 2 + 1];
  }
  cx /= m;
  cy /= m;
  for (let i = 0; i < m; i++) {
    const dx = hull[i * 2] - cx;
    const dy = hull[i * 2 + 1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    hull[i * 2] += (dx / len) * clear;
    hull[i * 2 + 1] += (dy / len) * clear;
  }
}

/** 质心写进 out2（[cx, cy]） */
export function hullCentroid(hull: number[], m: number, out2: number[]): void {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < m; i++) {
    cx += hull[i * 2];
    cy += hull[i * 2 + 1];
  }
  out2[0] = m ? cx / m : 0;
  out2[1] = m ? cy / m : 0;
}

// ─── 线段 × 凸包 ─────────────────────────────────────────────────────────────

/** clipSegment 的输出（模块级复用；单线程、非重入，取完立刻用掉） */
const clipOut = [0, 0];

/**
 * Cyrus–Beck：线段 P→Q 落在凸包内的参数区间写进 clipOut，返回是否相交。
 * 每条边的外法线取「背离质心」那一支，故与凸包绕向无关。
 */
function clipSegment(
  hull: number[], m: number, cx: number, cy: number,
  px: number, py: number, qx: number, qy: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dy = qy - py;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ax = hull[i * 2];
    const ay = hull[i * 2 + 1];
    let nx = hull[j * 2 + 1] - ay;
    let ny = ax - hull[j * 2];
    if (nx * (cx - ax) + ny * (cy - ay) > 0) {
      nx = -nx;
      ny = -ny;
    }
    const denom = nx * dx + ny * dy;
    const dist = nx * (px - ax) + ny * (py - ay); // >0 ⇒ P 在这条边外侧
    if (Math.abs(denom) < 1e-9) {
      if (dist > 0) return false; // 与边平行且整段在外
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) {
      t1 = t;
    }
    if (t0 > t1) return false;
  }
  clipOut[0] = t0;
  clipOut[1] = t1;
  return true;
}

/** 线段 P→Q「压在模型上」的长度(px)。擦边算 0 */
export function overLength(
  hull: number[], m: number, cx: number, cy: number,
  px: number, py: number, qx: number, qy: number,
): number {
  if (m < 3) return 0;
  if (!clipSegment(hull, m, cx, cy, px, py, qx, qy)) return 0;
  return (clipOut[1] - clipOut[0]) * Math.hypot(qx - px, qy - py);
}

/**
 * ── 路由（竖一段 + 横一段，恰好一个 90° 折角） ──────────────────────────────
 *
 * 「压在模型上」1px 折算成普通长度的多少 px。
 * 代价 = 总长 + OVER_W × 压模型长度。8 是实测选的：太小（≤3）就总是选「从锚点平着
 * 切出去」那条最短的线、哪怕它横穿半只鞋垫；太大（≥20）会为十几个像素把落点顶到
 * 卡片边角上，看着像接错了地方。
 */
const OVER_W = 8;
/**
 * 贴着鞋垫上/下沿走的那两条候选车道，离凸包再让开这么多(px)。
 * 不让开的话正好压在边界上的线会被 Cyrus–Beck 判成「在里面」，白算一笔压模型的账。
 */
const LANE_EPS = 3;
/** 竖段短于这个值(px)就当没折 —— 免得留一个一两像素的假折角 */
const FLAT = 0.5;

/** 候选落点高度（模块级复用；单线程、非重入，别在 useFrame 里造数组） */
const lanes: number[] = [];

/** 代价 = 总长 + OVER_W × 压在模型上的长度。路径就两段，直接摊开写 */
function legCost(
  hull: number[], m: number, cx: number, cy: number,
  px: number, py: number, ay: number, qx: number,
): number {
  let cost = 0;
  if (Math.abs(ay - py) > FLAT) {
    cost += Math.abs(ay - py) + OVER_W * overLength(hull, m, cx, cy, px, py, px, ay);
  }
  cost += Math.abs(qx - px) + OVER_W * overLength(hull, m, cx, cy, px, ay, qx, ay);
  return cost;
}

/**
 * 锚点 P(px,py) → 卡片近边 x=qx 的引线：先竖着走到落点高度，再平着扎进卡片。
 * 落点高度在 [yLo,yHi]（卡片近边的可用区间）里挑代价最小的那个。
 *
 * 写进 path 的是 2 或 3 个点（竖段退化时 2 个）。最后一点就是落点，
 * 调用方要用它的 y 当卡侧端点的纵坐标 —— 别再拿自己算的 attachY。
 */
export function routeLeader(
  hull: number[], m: number, cx: number, cy: number,
  px: number, py: number, qx: number, yLo: number, yHi: number,
  path: LeaderPath,
): void {
  const clamp = (v: number) => Math.min(yHi, Math.max(yLo, v));
  let bestY = clamp(py);

  if (m >= 3) {
    // 候选：① 与锚点同高（线最短）② 卡片上下缘 ③ 贴着鞋垫上/下沿的车道
    // ④ 区间里再均匀补几个，免得最优落在两个特征值之间时被漏掉
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < m; i++) {
      const y = hull[i * 2 + 1];
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    lanes.length = 0;
    lanes.push(bestY, yLo, yHi, clamp(y0 - LANE_EPS), clamp(y1 + LANE_EPS));
    for (let k = 1; k < 4; k++) lanes.push(yLo + ((yHi - yLo) * k) / 4);

    let bestCost = Infinity;
    for (let i = 0; i < lanes.length; i++) {
      const c = legCost(hull, m, cx, cy, px, py, lanes[i], qx);
      if (c < bestCost) {
        bestCost = c;
        bestY = lanes[i];
      }
    }
  }

  path.n = 0;
  path.xs[0] = px;
  path.ys[0] = py;
  path.n = 1;
  if (Math.abs(bestY - py) > FLAT) {
    path.xs[1] = px;
    path.ys[1] = bestY;
    path.n = 2;
  }
  path.xs[path.n] = qx;
  path.ys[path.n] = bestY;
  path.n++;
}
