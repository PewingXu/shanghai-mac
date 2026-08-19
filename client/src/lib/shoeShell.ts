/**
 * 鞋壳几何工具（解决方案页「鞋垫装进鞋壳」装配展示）
 *
 * 内置鞋壳 HS-05 40-41# 与成品鞋垫 comfort/sport 出自同一套 CAD 世界坐标，
 * 也就是说厂家已经把鞋垫摆在鞋壳里了 —— 装配关系是量出来的，不是凑出来的：
 *
 *   原始包围盒（未翻正）  鞋壳 x −1886.85..−1586.20 / y 731.10..1019.37 / z −121.89..0.03
 *                        舒缓 x −1876.65..−1596.40 / y 715.27..1011.20 / z −68.26..−11.50
 *   翻正(绕 Y 转 180°) + 各自 centerGeometry 之后：
 *                        Δx  0.54mm（忽略） / Δy −12.00mm / Δz +11.53mm
 *
 * 写成与尺寸无关的比例常数（见 SHELL_FIT），任何码数、任何鞋壳都能套：鞋壳跟着鞋垫缩放，
 * 两者相对关系永远等于 CAD 里的原生关系。
 *
 * 上传的鞋壳不保证摆位，走 autoOrientMatrix() 自动翻正 —— 该算法在
 * shell_pair / comfort_pair / sport_pair / 42-1_L / 单只鞋壳 共 5 个模型 ×
 * 24 种轴对齐姿态上逐一验证过可恢复到规范姿态，且在三个成品 pair 上解出的矩阵
 * 与现有 splitProductPair 的 rotY180 逐元素相等。
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { centerGeometry, splitPairByX, type BaseDims } from './insoleModel';

// ============ 鞋壳来源 ============

export interface ShellSource {
  /** 缓存键；上传件用「文件名+字节数」保证换文件必然换键 */
  id: string;
  label: string;
  /** 内置鞋壳：从 public 拉取 */
  url?: string;
  /** 上传鞋壳：内存里的 STL 原始字节，不落盘不走后端 */
  buffer?: ArrayBuffer;
  /** true = 与成品鞋垫同一套 CAD 坐标，跳过自动定向 */
  preOriented: boolean;
}

export const BUILTIN_SHELL: ShellSource = {
  id: 'hs05-40-41',
  label: 'HS-05 40-41# 鞋壳',
  url: '/models/shell_pair.stl',
  preOriented: true,
};

/**
 * 鞋垫↔鞋壳的原生比例（由上面那组 CAD 世界坐标直接解出）。
 * LEN_RATIO 用鞋垫【本体】长（comfort/sport 尾端 9% 小舌头不算，见 insoleModel.bodyLenMm）：
 *   269.30 / 288.27 = 0.9342，反算 269.3/0.9342 = 288.3 ✓
 */
export const SHELL_FIT = {
  /** 鞋垫本体长 ÷ 鞋壳全长 */
  LEN_RATIO: 269.3 / 288.27,
  /** 鞋垫宽 ÷ 鞋壳全宽 */
  WID_RATIO: 109.1 / 128.42,
  /** 鞋壳中心相对鞋垫中心的前移量 ÷ 鞋壳长 */
  DY_FRAC: 12.0 / 288.27,
  /** 鞋垫底面离鞋壳外底的高度 ÷ 鞋壳高 */
  DZ_FRAC: 11.53 / 121.91,
} as const;

// ============ 分析用采样 ============

/** 自动定向只看形状不看精度，抽样到 12 万三角足够，避免在 168 万面上反复全扫 */
const ANALYSIS_MAX_TRI = 120_000;
/** 底面薄片厚度占总高比例 */
const SLAB_FRAC = 0.12;
/** 占格统计的网格边长(mm) */
const CELL_MM = 4;

function triangleCount(geo: THREE.BufferGeometry): number {
  return geo.attributes.position.count / 3;
}

function analysisStride(triCount: number): number {
  return Math.max(1, Math.floor(triCount / ANALYSIS_MAX_TRI));
}

/** 网格键：坐标除以 4mm 后落在 ±1e5 内，拼成一个安全整数 */
function cellKey(ix: number, iy: number): number {
  return (ix + 100000) * 1000000 + (iy + 100000);
}

// ============ 自动定向 ============

/**
 * 沿 ±axis 方向「最低 SLAB_FRAC 薄片」在垂直平面上的占格数。
 * 鞋底那面又平又宽 → 占格多；领口/端面那侧 → 占格少。
 * 内置鞋壳宽 128.4 与高 121.9 几乎等长，只靠包围盒分不出上下，必须用这个判据。
 */
function bottomSlabCells(
  arr: ArrayLike<number>,
  triCount: number,
  stride: number,
  axis: number,
  sign: number,
): number {
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const h = sign * arr[o + k * 3 + axis];
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  const cut = hMin + SLAB_FRAC * (hMax - hMin);
  const a = (axis + 1) % 3;
  const b = (axis + 2) % 3;
  const cells = new Set<number>();
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const base = o + k * 3;
      if (sign * arr[base + axis] > cut) continue;
      cells.add(
        cellKey(Math.floor(arr[base + a] / CELL_MM), Math.floor(arr[base + b] / CELL_MM)),
      );
    }
  }
  return cells.size;
}

/**
 * 沿 axis 方向的三角形质心分布中，中段 [lo,hi] 内最长的连续空 bin 段长度。
 * 双脚合体件在两脚之间有明显空隙（实测三款 pair 都是 60 bin 里空 8 个），单只件没有。
 */
function longestMidGap(
  arr: ArrayLike<number>,
  triCount: number,
  stride: number,
  axis: number,
  nBins = 100,
  lo = 0.3,
  hi = 0.7,
): number {
  let cMin = Infinity;
  let cMax = -Infinity;
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    const c = (arr[o + axis] + arr[o + 3 + axis] + arr[o + 6 + axis]) / 3;
    if (c < cMin) cMin = c;
    if (c > cMax) cMax = c;
  }
  const span = cMax - cMin || 1;
  const hist = new Uint32Array(nBins);
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    const c = (arr[o + axis] + arr[o + 3 + axis] + arr[o + 6 + axis]) / 3;
    hist[Math.min(nBins - 1, Math.floor(((c - cMin) / span) * nBins))]++;
  }
  let best = 0;
  let run = 0;
  for (let i = 0; i < nBins; i++) {
    const mid = (i + 0.5) / nBins;
    if (hist[i] === 0 && mid >= lo && mid <= hi) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

/** 双脚合体判定：中段连续空 bin ≥ 3 */
const PAIR_GAP_MIN_BINS = 3;

/**
 * 求把任意摆位翻正到规范姿态的纯旋转（det=+1，绝不改手性）。
 * 规范姿态 = 底面朝下 / Y 从足跟指向足尖 / X 为横向，与现有成品垫约定一致。
 *
 * 顺序很关键：先定朝上轴，再按空隙定横向轴，最后定足尖朝向。
 * 不能先用「包围盒最长轴当足长」—— 双脚合体的鞋壳整体宽 300.66 > 长 288.27，那一步就错了。
 */
export function autoOrientMatrix(geo: THREE.BufferGeometry): THREE.Matrix4 {
  const arr = geo.attributes.position.array as ArrayLike<number>;
  const triCount = triangleCount(geo);
  const stride = analysisStride(triCount);

  // 1) 朝上轴：6 个候选取底面占格最多者
  let ez = new THREE.Vector3(0, 0, 1);
  let bestCells = -1;
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const cells = bottomSlabCells(arr, triCount, stride, axis, sign);
      if (cells > bestCells) {
        bestCells = cells;
        ez = new THREE.Vector3(0, 0, 0).setComponent(axis, sign);
      }
    }
  }
  const upAxis = ez.x !== 0 ? 0 : ez.y !== 0 ? 1 : 2;

  // 2) 横向轴：水平面内两轴里有双脚空隙的那个；都没有则取较短的那个（单只鞋，长 > 宽）
  const horiz = [0, 1, 2].filter((a) => a !== upAxis);
  const gaps = horiz.map((a) => longestMidGap(arr, triCount, stride, a));
  let crossAxis: number;
  if (Math.max(...gaps) >= PAIR_GAP_MIN_BINS) {
    crossAxis = horiz[gaps[0] >= gaps[1] ? 0 : 1];
  } else {
    const ext = horiz.map((a) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < triCount; t += stride) {
        const o = t * 9;
        for (let k = 0; k < 3; k++) {
          const v = arr[o + k * 3 + a];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      return hi - lo;
    });
    crossAxis = horiz[ext[0] <= ext[1] ? 0 : 1];
  }
  const ex = new THREE.Vector3(0, 0, 0).setComponent(crossAxis, 1);
  // 右手系 x×y=z ⇒ y=z×x，cross 保证 det=+1
  const ey = new THREE.Vector3().crossVectors(ez, ex);

  const m = new THREE.Matrix4().set(
    ex.x, ex.y, ex.z, 0,
    ey.x, ey.y, ey.z, 0,
    ez.x, ez.y, ez.z, 0,
    0, 0, 0, 1,
  );

  // 3) 足尖朝向：沿 Y 分 20 段量宽度剖面，最宽段（前掌）靠哪端、哪端就是足尖。
  //    实测 shell / comfort / sport / 42-1 的最宽段都落在第 13~14 段（跟端在 y 小的一侧）。
  if (widestBinIndex(arr, triCount, stride, m) < 10) {
    // 绕 Z 转 180°：(x,y,z)→(−x,−y,z)，纯旋转
    m.premultiply(new THREE.Matrix4().makeRotationZ(Math.PI));
  }
  return m;
}

const TOE_BINS = 20;

function widestBinIndex(
  arr: ArrayLike<number>,
  triCount: number,
  stride: number,
  m: THREE.Matrix4,
): number {
  const e = m.elements; // 列主序：新 x = e0*x+e4*y+e8*z，新 y = e1*x+e5*y+e9*z
  const px = (x: number, y: number, z: number) => e[0] * x + e[4] * y + e[8] * z;
  const py = (x: number, y: number, z: number) => e[1] * x + e[5] * y + e[9] * z;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const b = o + k * 3;
      const y = py(arr[b], arr[b + 1], arr[b + 2]);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const span = yMax - yMin || 1;
  const lo = new Float64Array(TOE_BINS).fill(Infinity);
  const hi = new Float64Array(TOE_BINS).fill(-Infinity);
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const b = o + k * 3;
      const X = arr[b];
      const Y = arr[b + 1];
      const Z = arr[b + 2];
      const i = Math.min(TOE_BINS - 1, Math.floor(((py(X, Y, Z) - yMin) / span) * TOE_BINS));
      const x = px(X, Y, Z);
      if (x < lo[i]) lo[i] = x;
      if (x > hi[i]) hi[i] = x;
    }
  }
  let best = 0;
  let bestW = -1;
  for (let i = 0; i < TOE_BINS; i++) {
    const w = hi[i] - lo[i];
    if (Number.isFinite(w) && w > bestW) {
      bestW = w;
      best = i;
    }
  }
  return best;
}

// ============ 手性判定 ============

const HAND_BINS = 24;
const HAND_TAIL = 4;
/** 低于此值认为判不出手性（正常件实测 |偏移| 在 0.12~0.20） */
export const HAND_MIN_CONFIDENCE = 0.03;

/**
 * 手性偏移：足尖段中线相对整只中线的横向偏移（除以半宽）。>0 左脚、<0 右脚。
 * 足尖是拇趾侧（内侧）最靠前，MEDIAL_ON_POSITIVE_X 约定下左脚内侧在 +X。
 *
 * 用【每段包围盒中点】而不是顶点均值 —— 顶点均值会被网格密度带偏：
 * comfort_pair 两只脚的晶格面数差 12%（47.3 万 vs 52.7 万），
 * 顶点均值算出来右脚是 +0.055（符号都反了），包围盒中线法两只干净对称 ±0.124。
 *
 * 实测：shell ±0.128 / comfort ±0.124 / sport ±0.125 / 42-1 ±0.151。
 */
export function handednessOffset(geo: THREE.BufferGeometry): number {
  const arr = geo.attributes.position.array as ArrayLike<number>;
  const triCount = triangleCount(geo);
  const stride = analysisStride(triCount);

  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const yMin = bb.min.y;
  const span = bb.max.y - yMin || 1;
  const cx = (bb.min.x + bb.max.x) / 2;
  const half = (bb.max.x - bb.min.x) / 2 || 1;

  const lo = new Float64Array(HAND_BINS).fill(Infinity);
  const hi = new Float64Array(HAND_BINS).fill(-Infinity);
  for (let t = 0; t < triCount; t += stride) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const b = o + k * 3;
      const i = Math.min(HAND_BINS - 1, Math.floor(((arr[b + 1] - yMin) / span) * HAND_BINS));
      const x = arr[b];
      if (x < lo[i]) lo[i] = x;
      if (x > hi[i]) hi[i] = x;
    }
  }
  let sum = 0;
  let n = 0;
  for (let i = HAND_BINS - HAND_TAIL; i < HAND_BINS; i++) {
    if (!Number.isFinite(lo[i])) continue;
    sum += (lo[i] + hi[i]) / 2;
    n++;
  }
  if (n === 0) return 0;
  return (sum / n - cx) / half;
}

// ============ 镜像 ============

/**
 * X 取反做出另一只脚。必须同时翻转三角形绕序 —— 只取反 X 会让所有面法线朝里。
 * STL 解析出的是非索引几何（每三角 3 个连续顶点），交换后两个顶点即可。
 */
export function mirrorGeometryX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = geo.attributes.position.array as ArrayLike<number>;
  const out = new Float32Array(src.length);
  for (let t = 0; t < src.length / 9; t++) {
    const o = t * 9;
    // v0 原位，v1↔v2 对调
    for (const [dst, s] of [[0, 0], [3, 6], [6, 3]] as const) {
      out[o + dst] = -src[o + s];
      out[o + dst + 1] = src[o + s + 1];
      out[o + dst + 2] = src[o + s + 2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

// ============ 组装 ============

export interface LoadedShell {
  geometry: THREE.BufferGeometry;
  base: BaseDims;
}

export interface ShellPairInfo {
  /** 源文件是双脚合体还是单只（单只时另一只由镜像得到） */
  pair: boolean;
  /** 手性判据的绝对值，< HAND_MIN_CONFIDENCE 说明没判准，UI 上提示用手动微调 */
  confidence: number;
  triangles: number;
}

export interface ShellPairResult {
  left: LoadedShell;
  right: LoadedShell;
  info: ShellPairInfo;
}

/**
 * STL 字节 → 左右两只已翻正居中的鞋壳。
 * preOriented（内置件）直接用 rotY180，与 insoleModel.splitProductPair 同一步；
 * 上传件走 autoOrientMatrix。左右归属一律由 handednessOffset 判定，不看谁在 −X。
 */
export function buildShellPair(buffer: ArrayBuffer, preOriented: boolean): ShellPairResult {
  const whole = new STLLoader().parse(buffer);
  if (!whole.attributes.normal) whole.computeVertexNormals();
  const triangles = triangleCount(whole);

  whole.applyMatrix4(
    preOriented ? new THREE.Matrix4().makeRotationY(Math.PI) : autoOrientMatrix(whole),
  );

  const arr = whole.attributes.position.array as ArrayLike<number>;
  const isPair =
    longestMidGap(arr, triangles, analysisStride(triangles), 0) >= PAIR_GAP_MIN_BINS;

  let a: THREE.BufferGeometry;
  let b: THREE.BufferGeometry;
  if (isPair) {
    const s = splitPairByX(whole);
    a = s.left;
    b = s.right;
    whole.dispose();
  } else {
    a = whole;
    b = mirrorGeometryX(whole);
  }

  const off = handednessOffset(a);
  const [leftGeo, rightGeo] = off >= 0 ? [a, b] : [b, a];

  return {
    left: { geometry: leftGeo, base: centerGeometry(leftGeo) },
    right: { geometry: rightGeo, base: centerGeometry(rightGeo) },
    info: { pair: isPair, confidence: Math.abs(off), triangles },
  };
}

// ============ 摆位换算 ============

/** 手动微调（自动识别没摆对时兜底）。三个翻转都是纯旋转，不改手性。 */
export interface ShellAdjust {
  /** 上下翻转：绕长度轴 Y 转 180° */
  flipUD: boolean;
  /** 前后调转：绕高度轴 Z 转 180° */
  flipFB: boolean;
  /** 左右互换：把两只鞋壳对调（自动手性判反时用） */
  swapLR: boolean;
  /** 整体缩放倍率，1 = 按 CAD 原生比例 */
  scale: number;
}

export const DEFAULT_SHELL_ADJUST: ShellAdjust = {
  flipUD: false,
  flipFB: false,
  swapLR: false,
  scale: 1,
};

export interface ShellPlacement {
  /** 相对原生几何的三轴缩放 */
  scale: { x: number; y: number; z: number };
  /** mm 局部帧下的平移（x 横向 / y 足长 / z 高度），已含缩放 */
  offsetMm: { x: number; y: number; z: number };
  /** 缩放后的鞋壳高度(mm)，上下翻转时用来把底面重新落回 z=0 */
  scaledHeiMm: number;
}

/**
 * 鞋壳摆位：跟着鞋垫的目标足长足宽缩放，相对关系永远等于 CAD 里的原生关系。
 *
 * 与 insoleModel.computeScales 自洽：那里 y = 目标足长 / bodyLenMm(...)，
 * 所以缩放后鞋垫【本体】长恰好 = footLengthCm*10，正是这里的输入。
 * X 单独按足宽缩放 —— 宽脚配宽鞋，鞋垫不会从侧壁穿出去。
 */
export function computeShellPlacement(
  base: BaseDims,
  opts: { footLengthCm: number; footWidthCm: number },
  adjust: ShellAdjust = DEFAULT_SHELL_ADJUST,
): ShellPlacement {
  const k = adjust.scale || 1;
  const sy = ((opts.footLengthCm * 10) / (SHELL_FIT.LEN_RATIO * (base.lenMm || 1))) * k;
  const sx = ((opts.footWidthCm * 10) / (SHELL_FIT.WID_RATIO * (base.widMm || 1))) * k;
  const sz = sy;
  return {
    scale: { x: sx, y: sy, z: sz },
    offsetMm: {
      x: 0,
      // 鞋壳中心比鞋垫中心靠前 12mm（等比）
      y: SHELL_FIT.DY_FRAC * base.lenMm * sy,
      // 鞋垫底面高于鞋壳外底 11.53mm ⇒ 鞋壳整体下沉
      z: -SHELL_FIT.DZ_FRAC * base.heiMm * sz,
    },
    scaledHeiMm: base.heiMm * sz,
  };
}

/**
 * 手动翻转对应的欧拉角（局部 mm 帧）与「把底面重新落回 z=0」的补偿位移。
 * 几何在 centerGeometry 之后是 X/Y 居中、Z∈[0,h]：
 *   flipUD  (x,y,z)→(−x,y,−z)  ⇒ Z∈[−h,0]，需补 +h
 *   flipFB  (x,y,z)→(−x,−y,z)  ⇒ 三轴范围都不变，无需补偿
 *   两者同开 (x,y,z)→(x,−y,−z) ⇒ 仍需补 +h
 */
export function shellAdjustTransform(
  adjust: ShellAdjust,
  scaledHeiMm: number,
): { rotation: [number, number, number]; liftMm: number } {
  const rotation: [number, number, number] = adjust.flipUD
    ? adjust.flipFB
      ? [Math.PI, 0, 0]
      : [0, Math.PI, 0]
    : adjust.flipFB
      ? [0, 0, Math.PI]
      : [0, 0, 0];
  return { rotation, liftMm: adjust.flipUD ? scaledHeiMm : 0 };
}
