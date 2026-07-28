/**
 * 鞋垫样式与几何工具（预览 StlInsoleViewer 与导出 stlInsoleExporter 共用）
 *
 * 三种样式：
 *  - comfort 舒缓：成品晶格垫（双脚合体单文件，孔大稀疏，偏缓冲）
 *  - sport   运动：成品晶格垫（双脚合体单文件，晶格细密，偏支撑）
 *  - standard 标准：旧 42 码基准垫（左右分文件，靠厚度参数缩放）
 *
 * 成品垫为「双脚合体」网格：按顶点 X 正负拆成 左(x<0)/右(x>0)，与旧 42-1_L/R 约定一致。
 * 高度缩放：
 *  - param        标准 42 垫，Z 由 基础/足弓矫正/足跟 厚度参数决定（原逻辑）
 *  - proportional 成品垫，Z 随足长等比缩放，保留原始纵向轮廓（不被厚度参数压扁）
 */

import * as THREE from 'three';

export type InsoleStyle = 'comfort' | 'sport' | 'standard';

export interface StyleDef {
  label: string;
  kind: 'pair' | 'split';
  /** kind==='pair' */
  url?: string;
  /** kind==='split' */
  left?: string;
  right?: string;
  heightMode: 'param' | 'proportional';
  /**
   * 尾端「小舌头」占全长的比例——从足跟杯后沿往后伸出的一小片，不属于鞋垫本体。
   * 实测自 STL（0.5% 切片看底缘 z）：成品垫 yN 0~0.090 段底缘悬在 24~42mm 高处、
   * 宽度仅 13.6→46mm，到 yN 0.095 底缘骤降到 18.4mm 才是杯体；标准垫 42-1 底缘
   * 在 yN 0.010 即落到 0，无此结构。
   * 用途：足长缩放按本体对齐，且足长归一 yN 从本体起点算——否则足弓 cos² 中心会
   * 落在本体 36.3%（应为 42%，偏后约 15mm），足跟缓冲峰值则落在舌头尖上。
   */
  heelTrimFrac: number;
  /** proportional 成品垫的单脚原生尺寸(mm)：用于按足长换算真实基础高度显示（param 垫无需） */
  nativeLenMm?: number;
  nativeHeiMm?: number;
}

/** 鞋垫本体长度(mm)：全长扣掉尾端小舌头 */
export function bodyLenMm(lenMm: number, style: InsoleStyle): number {
  return lenMm * (1 - STYLE_DEFS[style].heelTrimFrac);
}

// 成品垫原生尺寸由 STL 实测（绕 Y 翻正 + 按 X 拆单脚 + 居中后的包围盒）：
//   舒缓 单脚 长295.93 / 高56.76 mm；运动 单脚 长295.97 / 高56.49 mm（≈49码）。
export const STYLE_DEFS: Record<InsoleStyle, StyleDef> = {
  // 成品垫(舒缓/运动)：proportional —— Z 随足长等比缩放(z=y)，保留刚嵌入时的原始高度，不被整体压扁。
  //   基础厚度默认=原生高度按足长等比换算(见 productBaseHeightMm)，仍可调；调节量相对默认值以
  //   「顶面局部隆起」叠加(deform.baseMm / applyDeform / DEFORM_GLSL)，足弓矫正/足跟同理。
  // 内置标准垫：param —— Z 由厚度参数(基础+足弓矫正+足跟)整体决定(原逻辑)。
  // heelTrimFrac：成品垫尾端有 26.6mm 的小舌头（实测 yN 0~0.090），本体长 269.3mm；标准垫无。
  comfort: { label: '舒缓', kind: 'pair', url: '/models/comfort_pair.stl', heightMode: 'proportional', heelTrimFrac: 0.09, nativeLenMm: 295.93, nativeHeiMm: 56.76 },
  sport: { label: '运动', kind: 'pair', url: '/models/sport_pair.stl', heightMode: 'proportional', heelTrimFrac: 0.09, nativeLenMm: 295.97, nativeHeiMm: 56.49 },
  standard: { label: '标准', kind: 'split', left: '/models/42-1_L.stl', right: '/models/42-1_R.stl', heightMode: 'param', heelTrimFrac: 0 },
};

/**
 * proportional 成品垫按足长换算后的真实基础高度(mm)。
 * = 原生高度 × (目标足长 / 原生【本体】长)，与 computeScales 的 proportional Z 缩放同源。
 * 分母用本体长而非全长——足长对齐的是鞋垫本体，尾端小舌头不算在内。
 * 非 proportional 或缺原生尺寸时返回 null（调用方回退到参数化 baseThickness）。
 */
export function productBaseHeightMm(style: InsoleStyle, footLengthCm: number): number | null {
  const def = STYLE_DEFS[style];
  if (def.heightMode !== 'proportional' || !def.nativeLenMm || !def.nativeHeiMm) return null;
  return def.nativeHeiMm * ((footLengthCm * 10) / bodyLenMm(def.nativeLenMm, style));
}

/** 选择器展示顺序 */
export const STYLE_ORDER: InsoleStyle[] = ['comfort', 'sport', 'standard'];

/** 原生尺寸(mm)：足长(Y) / 足宽(X) / 高度(Z) */
export interface BaseDims {
  lenMm: number;
  widMm: number;
  heiMm: number;
}

/** 居中到原点（XY 居中、底面贴 z=0），返回原生尺寸(mm) */
export function centerGeometry(geo: THREE.BufferGeometry): BaseDims {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const cx = (b.max.x + b.min.x) / 2;
  const cy = (b.max.y + b.min.y) / 2;
  const cz = b.min.z;
  geo.translate(-cx, -cy, -cz);
  return { widMm: b.max.x - b.min.x, lenMm: b.max.y - b.min.y, heiMm: b.max.z - b.min.z };
}

/**
 * 将「双脚合体」网格按三角形质心 X 拆成 左 / 右 两个几何体。
 * 以模型自身包围盒 X 中点为分界（成品垫在 CAD 世界坐标里整体偏移，不能用 x=0 硬分）；
 * 更靠 -X 的一半记为「左」，与旧 42-1_L(负 X) 约定一致。
 * STL 解析出的是非索引几何（每三角 3 个连续顶点），两遍扫描直接写入定长 Float32Array。
 */
export function splitPairByX(geo: THREE.BufferGeometry): {
  left: THREE.BufferGeometry;
  right: THREE.BufferGeometry;
} {
  const arr = geo.attributes.position.array as ArrayLike<number>;
  const triCount = geo.attributes.position.count / 3;

  geo.computeBoundingBox();
  const midX = (geo.boundingBox!.min.x + geo.boundingBox!.max.x) / 2;

  // 第一遍：标记归属并计数
  const isLeft = new Uint8Array(triCount);
  let nLeft = 0;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cx = (arr[o] + arr[o + 3] + arr[o + 6]) / 3;
    if (cx < midX) {
      isLeft[t] = 1;
      nLeft++;
    }
  }
  const nRight = triCount - nLeft;

  // 第二遍：填充
  const lp = new Float32Array(nLeft * 9);
  const rp = new Float32Array(nRight * 9);
  let li = 0;
  let ri = 0;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    if (isLeft[t]) {
      for (let k = 0; k < 9; k++) lp[li++] = arr[o + k];
    } else {
      for (let k = 0; k < 9; k++) rp[ri++] = arr[o + k];
    }
  }

  const build = (data: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data, 3));
    g.computeVertexNormals();
    return g;
  };
  return { left: build(lp), right: build(rp) };
}

/**
 * 加载成品「双脚合体」网格 → 翻正朝向 + 拆成解剖左右（各自未居中，调用方再 centerGeometry）。
 * 成品垫在 CAD 里「底面朝上」：绕长度轴(Y)旋转 180° 翻正 —— 这是纯旋转(行列式+1)，
 * (x,y,z)→(-x,y,-z)：Z(高度)翻转使鞋垫底面朝下，法线自洽不会内外翻；toe/heel(Y) 不受影响。
 * X 只是被整体挪位(不是镜像/不改手性)，旋转后 splitPairByX 已按「更靠 -X 为左」正确归类，
 * 故此处直接返回、不再对调左右（此前多做一次对调导致左右脚颠倒）。
 */
export function splitProductPair(whole: THREE.BufferGeometry): {
  left: THREE.BufferGeometry;
  right: THREE.BufferGeometry;
} {
  whole.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
  return splitPairByX(whole);
}

// ─── 顶面隆起变形（只抬顶面，底面保持平） ──────────────────────────────────────
// 高度模型以 v1.0 晶格版 latticeGeometry.ts 的 getInsoleHeight 为准（逐点高度场）：
//   baseHeight = baseThickness + archHeight + heelCup + heelCushion
//   足弓 archHeight 是 cos² 局部凸起（中心 42% 足长、半宽 0.18）且按内侧加权，
//   足跟 heelCushion 在后 35% 内 cos² 衰减。
// 三处必要适配（生成式高度场 → 固定网格位移）：
//   1. 不含 heelCup —— 它是与参数无关的固定 0.15cm 基底形状，成品垫网格里本就有
//      足跟杯，计入即重复叠加。
//   2. xNorm 取网格实际 X 包围盒，而非 v1.0 的 footLength*0.2 —— v1.0 自己生成
//      轮廓才能那么算，贴到实测网格上须用真实边界。
//   3. 保留 topW 顶面权重 —— v1.0 直接生成顶面，我们是形变既有网格，靠 topW 保证底面平整。
// 由厚度参数驱动：archMm → 足弓 cos² 凸起，heelMm → 后跟 cos² 缓冲，baseMm → 整只顶面均匀抬高。
// 足长归一 yN：0=后跟 .. 1=足尖；足宽归一 xN：0..1。
// 同一套公式在 GPU 着色器(DEFORM_GLSL) 与下方 CPU 版(applyDeform) 各实现一遍——改一处务必同步另一处。

export interface DeformMm {
  archMm: number;
  heelMm: number;
  baseMm: number;
}

export const ZERO_DEFORM: DeformMm = { archMm: 0, heelMm: 0, baseMm: 0 };

export function hasDeform(d: DeformMm): boolean {
  return d.archMm !== 0 || d.heelMm !== 0 || d.baseMm !== 0;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// 足弓 cos² 凸起参数（v1.0 原值）
const ARCH_CENTER = 0.42;
const ARCH_HALF_WIDTH = 0.18;
// 足跟缓冲影响范围（v1.0 heelCushionZone）
const HEEL_ZONE = 0.35;

/**
 * 内外侧朝向：网格 +X 是否为内侧（拇趾侧）。经验值——
 * 若预览里足弓支撑出现在外侧（小趾侧），把此值改为 false 即可整体翻转。
 */
export const MEDIAL_ON_POSITIVE_X = true;

/** 足弓 cos² 纵向剖面：中心最强、向两端在半宽内衰减到 0，区外为 0 */
function archProfile(yN: number): number {
  const d = Math.abs(yN - ARCH_CENTER) / ARCH_HALF_WIDTH;
  if (d >= 1) return 0;
  const c = Math.cos((d * Math.PI) / 2);
  return c * c;
}

/**
 * 把「内外侧朝向」与「左右脚」合成一个符号，供 CPU/GPU 共用：
 *   inner = clamp((1 + sign·nX) / 2, 0, 1)
 * 左脚 +1、右脚 −1，再被 MEDIAL_ON_POSITIVE_X 整体翻转。
 */
export function medialSign(foot: 'left' | 'right'): number {
  return (foot === 'left' ? 1 : -1) * (MEDIAL_ON_POSITIVE_X ? 1 : -1);
}

/** 内侧因子 0..1：足弓支撑偏内侧（v1.0 rawInner） */
function innerFactor(xN: number, foot: 'left' | 'right'): number {
  const nX = Math.max(-1, Math.min(1, (xN - 0.5) * 2));
  return Math.max(0, Math.min(1, (1 + medialSign(foot) * nX) / 2));
}

/** 顶面位移(mm)：yN 足长归一(0后跟..1足尖)，xN 足宽归一(0..1)，topW 顶面权重(0底..1顶) */
function displacementMm(
  yN: number,
  xN: number,
  topW: number,
  d: DeformMm,
  foot: 'left' | 'right',
): number {
  const archAt = d.archMm * archProfile(yN) * (0.3 + 0.7 * innerFactor(xN, foot));
  let heelAt = 0;
  if (yN < HEEL_ZONE) {
    const c = Math.cos((yN / HEEL_ZONE) * (Math.PI / 2));
    heelAt = d.heelMm * c * c;
  }
  return topW * (archAt + heelAt + d.baseMm);
}

/**
 * 足长归一的起点与跨度：从【鞋垫本体】起点算，尾端小舌头不参与。
 * 舌头段 y < yStart ⇒ yN 被 clamp 到 0 ⇒ 与足跟后缘取到同一位移，跟着足跟平移，
 * 交界处连续、不会出台阶。CPU 与 GPU 共用这一份，避免两处漂移。
 */
export function lengthNorm(geo: THREE.BufferGeometry, style: InsoleStyle): { yStart: number; yRange: number } {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const full = b.max.y - b.min.y;
  const yStart = b.min.y + STYLE_DEFS[style].heelTrimFrac * full;
  return { yStart, yRange: (b.max.y - yStart) || 1 };
}

/** 顶面权重参数：从几何 Z 范围取上半段做平滑过渡（底面权重 0 → 保持平） */
export function topWeightBounds(geo: THREE.BufferGeometry): { zMid: number; zTop: number } {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const zRange = b.max.z - b.min.z;
  return { zMid: b.min.z + 0.35 * zRange, zTop: b.min.z + 0.9 * zRange };
}

/** CPU 版顶面隆起（导出烘焙用）：原地修改 position.z 并重算法线 */
export function applyDeform(
  geo: THREE.BufferGeometry,
  d: DeformMm,
  foot: 'left' | 'right',
  style: InsoleStyle,
): void {
  if (!hasDeform(d)) return;
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const { yStart, yRange } = lengthNorm(geo, style);
  const xMin = b.min.x;
  const xRange = b.max.x - b.min.x || 1;
  const { zMid, zTop } = topWeightBounds(geo);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // clamp：舌头段 yN<0 取 0，与足跟后缘同位移
    const yN = Math.max(0, Math.min(1, (y - yStart) / yRange));
    const xN = (x - xMin) / xRange;
    const topW = smoothstep(zMid, zTop, z);
    const disp = displacementMm(yN, xN, topW, d, foot);
    if (disp !== 0) pos.setZ(i, z + disp);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
}

/**
 * 数字 → GLSL float 字面量。GLSL 里 `1` 是 int，与 float 混算会编译失败，
 * 而着色器只在运行时编译、tsc 查不出来。凡是插进 GLSL 模板的常量都过这里。
 */
function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/** GPU 版顶面隆起：注入到顶点着色器 begin_vertex 之后（与 applyDeform 同公式） */
export const DEFORM_UNIFORM_DECL = `
  uniform float uYMin; uniform float uYRange; uniform float uZMid; uniform float uZTop;
  uniform float uXMin; uniform float uXRange; uniform float uMedialSign;
  uniform float uArchMm; uniform float uHeelMm; uniform float uBaseMm;
  uniform float uHeatMode; uniform float uBaseThickMm;
`;

export const DEFORM_GLSL = `
  // uYMin 是【本体】起点（已扣尾端小舌头）；clamp 使舌头段与足跟后缘同位移
  float _yN = clamp((transformed.y - uYMin) / uYRange, 0.0, 1.0);
  float _xN = (transformed.x - uXMin) / uXRange;
  float _topW = smoothstep(uZMid, uZTop, transformed.z);

  // 足弓 cos² 凸起（中心 0.42 / 半宽 0.18），偏内侧
  float _ad = abs(_yN - ${glslFloat(ARCH_CENTER)}) / ${glslFloat(ARCH_HALF_WIDTH)};
  float _ac = cos(clamp(_ad, 0.0, 1.0) * 1.5707963);
  float _archProfile = _ad < 1.0 ? _ac * _ac : 0.0;
  float _nX = clamp((_xN - 0.5) * 2.0, -1.0, 1.0);
  float _inner = clamp((1.0 + uMedialSign * _nX) * 0.5, 0.0, 1.0);
  float _archAt = uArchMm * _archProfile * (0.3 + 0.7 * _inner);

  // 足跟 cos² 缓冲（后 35%）
  float _hc = cos((_yN / ${glslFloat(HEEL_ZONE)}) * 1.5707963);
  float _heelAt = _yN < ${glslFloat(HEEL_ZONE)} ? uHeelMm * _hc * _hc : 0.0;

  float _disp = _topW * (_archAt + _heelAt + uBaseMm);
  transformed.z += _disp;

  // 热力上色量按款式分两种口径：
  //  uHeatMode=0 成品垫 —— 定制位移量（舌头跟着足跟走，一并上色）
  //  uHeatMode=1 标准垫 —— 它整只 Z 缩放、没有位移量，改用「相对基准厚度（那层平底板）的起伏」：
  //    z − 基础厚度。默认即有颜色：足弓约 +11.8mm、后跟 +9.6mm、前掌 −1.3mm。
  //
  //    ⚠ 已知取舍，勿当 bug「修」：调大【基础厚度】时下半部分会变蓝（顶端不变）。
  //    因为标准垫的基础厚度不是独立的平底板，它和矫正、足跟一起当总高度整只缩放
  //    （z = z_原生 ×(基厚+矫正+足跟)/29.32），既在 z 里又当减数，
  //    对基厚求导 = z_原生/29.32 − 1 ≤ 0。要两个直觉都成立须改几何（让基厚成为真正的平底板，
  //    即 v1.0 高度场那套），已明确搁置。此处按「相对 3mm 基准」口径定稿。
  vDispMm = uHeatMode > 0.5 ? (transformed.z - uBaseThickMm) : _disp;
`;

// ─── 定制形变热力图（相对标准成品垫的加厚/减薄可视化） ─────────────────────────
// 位移量 vDispMm 由顶点着色器直接传给片元着色器——与真实几何形变同源同公式，
// 颜色即真实位移，不存在两处各算各的。

/**
 * 发散色标。中点必须中性灰：鞋垫本色可被用户改成「天蓝」，
 * 若中点用彩色会与负极撞色。热力模式下整体替换 diffuseColor，忽略用户选色。
 * 经 dataviz 校验器实测（暖色浅底 #fff7ea）：CVD ΔE 21.6(protan)、
 * 常规视觉 ΔE 32.3、对比度均 ≥3:1，全项通过。
 */
export const HEAT_COLORS = {
  neg: '#2a78d6', // 蓝：减薄
  mid: '#ECECEC', // 中性灰：未改动
  pos: '#e34948', // 红：加厚
} as const;

/** 成品垫色标满量程(mm)：对齐足弓矫正滑块上限；超出即钳制，保证跨客户可比 */
export const HEAT_MAX_MM = 12;

/**
 * 标准垫色标满量程(mm)。它的口径是「型面高度 − 基础厚度」，量级比定制位移大得多——
 * 实测重度扁平(基厚3/矫正8/足跟25)时足弓达 +31mm、后跟 +26mm，用 12mm 会双双顶满、
 * 区域差异全糊掉。取 30mm 让常见档位都落在色标内。
 * 两款口径本就不同（图例标题已分别标注），量程不同不影响各自可读。
 */
export const HEAT_MAX_STD_MM = 30;

/** 顶点/片元着色器都要声明 */
export const HEAT_VARYING_DECL = `varying float vDispMm;
`;

export const HEAT_UNIFORM_DECL = `
  uniform float uHeatOn; uniform float uHeatMaxMm;
  uniform vec3 uHeatNeg; uniform vec3 uHeatMid; uniform vec3 uHeatPos;
`;

/** 注入到片元着色器 color_fragment 之后 */
export const HEAT_FRAGMENT_GLSL = `
  if (uHeatOn > 0.5) {
    float _t = clamp(vDispMm / uHeatMaxMm, -1.0, 1.0);
    diffuseColor.rgb = _t < 0.0 ? mix(uHeatMid, uHeatNeg, -_t)
                                : mix(uHeatMid, uHeatPos,  _t);
  }
`;


/**
 * 相对「标准成品垫原生几何」的个性化形变量(mm)。
 *
 * 成品垫(proportional)的 computeScales 只按足长等比缩放，archCorrection/heelThickness
 * 完全不进几何；个性化全靠这里换算出的 DeformMm 叠加，预览与导出共用同一份。
 * 足弓矫正与足跟缓冲在 UI 上本就是「相对基础垫的增量」（滑块带 + 前缀、0mm=无缓冲），
 * 故全额计入；基础厚度则取相对该样式原生高度的偏移。
 *
 * 标准垫(param)返回 ZERO_DEFORM —— 它的三参数已由 computeScales 折进整体 Z 缩放，
 * 再叠位移会重复计算。
 */
export function personalDeform(
  p: {
    footLength: number;
    archCorrection: number;
    heelThickness: number;
    baseThickness: number;
  },
  style: InsoleStyle,
): DeformMm {
  const nativeMm = productBaseHeightMm(style, p.footLength);
  if (nativeMm == null) return ZERO_DEFORM;
  return {
    archMm: p.archCorrection,
    heelMm: p.heelThickness,
    baseMm: p.baseThickness * 10 - nativeMm,
  };
}

/**
 * 计算三轴缩放：X/Y 贴合目标足长足宽；Z 视 heightMode 而定。
 * 足长对齐的是【鞋垫本体】——分母扣掉尾端小舌头，否则本体会比脚短一截。
 */
export function computeScales(
  base: BaseDims,
  style: InsoleStyle,
  opts: {
    footLengthCm: number;
    footWidthCm: number;
    baseThicknessCm: number;
    archCorrectionMm: number;
    heelThicknessMm: number;
  },
): { x: number; y: number; z: number } {
  const targetLenMm = opts.footLengthCm * 10;
  const targetWidMm = opts.footWidthCm * 10;
  const x = targetWidMm / base.widMm;
  const y = targetLenMm / bodyLenMm(base.lenMm, style);
  let z: number;
  if (STYLE_DEFS[style].heightMode === 'param') {
    const totalHeightMm = opts.baseThicknessCm * 10 + opts.archCorrectionMm + opts.heelThicknessMm;
    z = totalHeightMm / base.heiMm;
  } else {
    z = y; // 成品垫：随足长等比，保留原始纵向轮廓
  }
  return { x, y, z };
}
