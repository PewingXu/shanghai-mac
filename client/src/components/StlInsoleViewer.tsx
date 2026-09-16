/**
 * STL 鞋垫 3D 预览组件 v4
 *
 * 支持三种样式（舒缓 / 运动 / 标准）自由切换：
 *  - 舒缓 / 运动：成品晶格垫，双脚合体单文件 → 按 X 正负拆成左右，各自居中
 *  - 标准：旧 42 码基准垫，左右分文件
 * 基准尺寸从几何包围盒动态求出（不再写死 42 码），三种样式均能正确缩放贴合脚型。
 * 高度：标准垫由厚度参数决定；成品垫随足长等比（保留原始纵向轮廓）。
 * 软硬仅通过材质观感体现（Shore A），不改几何。
 */

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import { Suspense, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Loader2, AlertTriangle, RefreshCw, Layers } from 'lucide-react';
import {
  STYLE_DEFS,
  centerGeometry,
  splitProductPair,
  computeScales,
  topWeightBounds,
  lengthNorm,
  medialSign,
  DEFORM_UNIFORM_DECL,
  DEFORM_GLSL,
  HEAT_VARYING_DECL,
  HEAT_UNIFORM_DECL,
  HEAT_FRAGMENT_GLSL,
  HEAT_COLORS,
  HEAT_MAX_MM,
  HEAT_MAX_STD_MM,
  ZERO_DEFORM,
  topDisplacementMm,
  type InsoleStyle,
  type BaseDims,
  type DeformMm,
} from '@/lib/insoleModel';
import { convexHull, expandHull, hullCentroid, HULL_CLEAR } from '@/lib/leaderRoute';
import {
  BUILTIN_SHELL,
  buildShellPair,
  computeShellPlacement,
  shellAdjustTransform,
  DEFAULT_SHELL_ADJUST,
  type ShellSource,
  type ShellAdjust,
  type ShellPairInfo,
  type LoadedShell,
} from '@/lib/shoeShell';

/** mm 几何 → 场景单位 */
const SCENE_SCALE = 0.01;
/** 鞋壳本色：中性冷灰，不与任何鞋垫可选色撞色 */
const SHELL_COLOR = '#AEB6BF';

/** 鞋壳三态：仅鞋垫 / 仅鞋壳 / 装配 */
export type ShellView = 'off' | 'only' | 'assembly';

// ============ 「对比前后」标注锚点（移植自 aciki-plantar-pressure） ============

/** 一个标注锚点：xN 足宽归一(0..1)，yN 足长归一(0 后跟..1 足尖)，都与形变公式同源 */
export interface InsoleAnchor {
  id: string;
  xN: number;
  yN: number;
}

/** 锚点投到画布上的 CSS 像素坐标（画布左上为原点） */
export interface InsoleAnchorPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * 一帧的投影结果。除了锚点，还带两样东西：
 *   hull  —— 模型投影的凸包（已外扩 HULL_CLEAR），随机位每帧变；引线拿它绕行，见 lib/leaderRoute
 *   rest* —— 模型的【旋转不变横向包络】，标注卡拿它定页边距
 *
 * rest* 是「把相机绕着支点转一整圈（方位角 360°、仰角走满 OrbitControls 的极角范围），
 * 模型投影在屏幕横向上**永远**落在 [restLeft, restRight] 之内」的那条界。
 * 卡片不遮鞋垫（任何朝向都不遮）+ 转的时候卡片一动不动，两件事同时成立。
 * 它只随【画布尺寸 / 尺码 / 双脚间距 / 缩放距离】变，方位角和仰角怎么拖都不动。
 *
 * ⚠ 数组是复用的，回调里用完即弃，别存引用。
 */
export interface InsoleProjection {
  points: InsoleAnchorPoint[];
  /** 凸包顶点，扁平 [x,y,…]，有效 hullLen 个 */
  hull: number[];
  hullLen: number;
  hullCx: number;
  hullCy: number;
  /** 旋转不变包络的左边界(px)。算不出来时为 0 */
  restLeft: number;
  /** 旋转不变包络的右边界(px)。算不出来时为 0（调用方据此判断「没有有效值」） */
  restRight: number;
}

const topZNCache = new WeakMap<THREE.BufferGeometry, Map<string, number>>();

/**
 * 采样某 (xN,yN) 处的顶面高度，返回【归一化 zN】(0 底面 .. 1 最高点)。
 *
 * 用 zN 而不是 mm，是为了能挂在**未缩放的源几何**上缓存：prepareGeometry 只做三轴正缩放，
 * 而 (x−xMin)/xRange 这类归一量在正缩放下不变，一份采样结果对该款式所有尺码都成立。
 * 否则每拖一下厚度滑块 → 新的 preparedGeometry → 重新扫几十万个顶点，滑块直接卡住。
 *
 * 取「半径内顶点的最大 z」而不是射线求交：对几十万面的网格一次线性扫描更省事。
 * 半径内取不到点就逐步放大（足尖/后缘附近顶点稀疏）。
 */
function sampleTopZN(geo: THREE.BufferGeometry, style: InsoleStyle, a: InsoleAnchor): number {
  let byId = topZNCache.get(geo);
  if (!byId) {
    byId = new Map();
    topZNCache.set(geo, byId);
  }
  const key = `${style}:${a.xN.toFixed(3)}:${a.yN.toFixed(3)}`;
  const cached = byId.get(key);
  if (cached !== undefined) return cached;

  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const xMin = b.min.x;
  const xRange = b.max.x - b.min.x || 1;
  const zMin = b.min.z;
  const zRange = b.max.z - b.min.z || 1;
  // 足长归一与着色器同源（已扣掉尾端小舌头）
  const { yStart, yRange } = lengthNorm(geo, style);
  const tx = xMin + a.xN * xRange;
  const ty = yStart + a.yN * yRange;

  const pos = geo.attributes.position;
  let best = -Infinity;
  for (const r of [0.03, 0.06, 0.12, 0.25]) {
    const rx = r * xRange;
    const ry = r * yRange;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - tx) > rx) continue;
      if (Math.abs(pos.getY(i) - ty) > ry) continue;
      const z = pos.getZ(i);
      if (z > best) best = z;
    }
    if (best > -Infinity) break;
  }
  const zN = best > -Infinity ? (best - zMin) / zRange : 1;
  byId.set(key, zN);
  return zN;
}

/**
 * 32 个均匀铺在球面上的方向（Fibonacci 球）。取模型在这些方向上的最远顶点，
 * 这组「支撑点」的凸包就近似模型的 3D 凸包 —— 而【投影的凸包 = 凸包的投影】，
 * 所以每帧只投这 32 个点就能拿到屏幕轮廓，不必每帧碰几十万个顶点。
 */
const SUPPORT_DIRS = (() => {
  const n = 32;
  const dirs: number[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * i + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const th = i * ga;
    dirs.push(Math.cos(th) * r, Math.sin(th) * r, z);
  }
  return dirs;
})();

const supportCache = new WeakMap<THREE.BufferGeometry, Float32Array>();

/**
 * 支撑点（毫米局部坐标）。挂在**已缩放的**几何上缓存：三轴缩放不一致，极值点会换。
 * 顶点抽样上限 2 万：抽样只会让凸包略微内缩几个像素，而包本来还要外扩 HULL_CLEAR。
 */
function supportPoints(geo: THREE.BufferGeometry): Float32Array {
  const hit = supportCache.get(geo);
  if (hit) return hit;

  const pos = geo.attributes.position;
  const nDir = SUPPORT_DIRS.length / 3;
  const bestDot = new Float64Array(nDir).fill(-Infinity);
  const bestIdx = new Int32Array(nDir).fill(0);
  const stride = Math.max(1, Math.ceil(pos.count / 20000));

  for (let i = 0; i < pos.count; i += stride) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    for (let d = 0; d < nDir; d++) {
      const dot = x * SUPPORT_DIRS[d * 3] + y * SUPPORT_DIRS[d * 3 + 1] + z * SUPPORT_DIRS[d * 3 + 2];
      if (dot > bestDot[d]) {
        bestDot[d] = dot;
        bestIdx[d] = i;
      }
    }
  }

  const out = new Float32Array(nDir * 3);
  for (let d = 0; d < nDir; d++) {
    const i = bestIdx[d];
    out[d * 3] = pos.getX(i);
    out[d * 3 + 1] = pos.getY(i);
    out[d * 3 + 2] = pos.getZ(i);
  }
  supportCache.set(geo, out);
  return out;
}

/**
 * OrbitControls 的极角范围。旋转不变包络要在**整个**范围上取最大值，
 * 所以这两个数必须和 <OrbitControls minPolarAngle/maxPolarAngle> 同源，别各写一份。
 */
const POLAR_MIN = 0.2;
const POLAR_MAX = Math.PI / 2.1;
/** 极角采样段数：包络对极角不是单调的，只能采样取最大 */
const POLAR_SAMPLES = 12;

/**
 * 模型投影在屏幕横向上的【旋转不变包络】半宽(px)：相机绕支点转任意方位角、
 * 任意（范围内的）仰角，模型都不会超出支点两侧这么宽。
 *
 * 推导（up 恒为 +Y、无 roll）：设某点相对支点的水平半径 ρ、高度 y，相机极角 θ、距离 d，
 *   max|x_px| = F·ρ / √((d − y·cos θ)² − ρ²·sin²θ)，F = (画布高/2)/tan(fov/2)
 * 方位角被解析地消掉了，只有极角要采样。分母 ≤ 0 表示投影发散，返回 Infinity 让调用方退回设计值。
 */
function envelopeHalfWidth(
  world: Float32Array,
  tx: number, ty: number, tz: number,
  dist: number,
  focalPx: number,
): number {
  let best = 0;
  for (let s = 0; s <= POLAR_SAMPLES; s++) {
    const th = POLAR_MIN + ((POLAR_MAX - POLAR_MIN) * s) / POLAR_SAMPLES;
    const ct = Math.cos(th);
    const st2 = Math.sin(th) ** 2;
    for (let i = 0; i < world.length; i += 3) {
      const dx = world[i] - tx;
      const dy = world[i + 1] - ty;
      const dz = world[i + 2] - tz;
      const rho2 = dx * dx + dz * dz;
      const k = dist - dy * ct;
      const den = k * k - rho2 * st2;
      if (den <= 1e-6) return Infinity;
      const w = focalPx * Math.sqrt(rho2 / den);
      if (w > best) best = w;
    }
  }
  return best;
}

/**
 * 把锚点从「毫米几何坐标」投到画布像素，每帧回调一次。
 *
 * 每帧算而不是转完相机算一次：卡片钉在页面上、引线端点跟着模型跑，端点位置只有相机说了算，
 * OrbitControls 的阻尼还会在松手后继续滑，只有逐帧投影才跟得住。
 * 每帧只做几十个点的矩阵乘法，代价可忽略；关键是**回调里不能 setState**，
 * 调用方拿到点后直接改 SVG 属性（见 InsoleCompareOverlay.update）。
 */
function useAnchorProjection(
  meshRef: React.RefObject<THREE.Mesh | null>,
  /** 未缩放的源几何：顶面高度在这上面采样并缓存 */
  sourceGeo: THREE.BufferGeometry,
  /** 缩放后、真正上屏的几何：锚点的毫米坐标要在它的包围盒里还原 */
  scaledGeo: THREE.BufferGeometry,
  style: InsoleStyle,
  deform: DeformMm,
  foot: 'left' | 'right',
  anchors: InsoleAnchor[] | undefined,
  onProject: ((p: InsoleProjection) => void) | undefined,
  /** 这只脚沿世界 X 的偏移（双脚并排时非零）*/
  positionX: number,
) {
  const { size } = useThree();
  // 旋转支点：OrbitControls 挂了 makeDefault 才拿得到，拿不到就退回原点
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null;
  // 回调常是内联函数：放 ref 里，免得进 useMemo 依赖后每次渲染都重算锚点局部坐标
  const cbRef = useRef(onProject);
  cbRef.current = onProject;

  // 锚点的毫米局部坐标：顶面采样高度 + 该点的形变抬升（与着色器同一个公式）
  const locals = useMemo(() => {
    if (!anchors?.length) return null;
    scaledGeo.computeBoundingBox();
    const b = scaledGeo.boundingBox!;
    const xRange = b.max.x - b.min.x || 1;
    const zRange = b.max.z - b.min.z || 1;
    const { yStart, yRange } = lengthNorm(scaledGeo, style);
    return anchors.map((a) => {
      const zN = sampleTopZN(sourceGeo, style, a);
      return {
        id: a.id,
        v: new THREE.Vector3(
          b.min.x + a.xN * xRange,
          yStart + a.yN * yRange,
          b.min.z + zN * zRange + topDisplacementMm(a.yN, a.xN, deform, foot),
        ),
      };
    });
  }, [sourceGeo, scaledGeo, style, anchors, deform, foot]);

  const support = useMemo(() => (anchors?.length ? supportPoints(scaledGeo) : null), [scaledGeo, anchors]);
  // 输出全部复用：每帧新建对象会给 GC 添 60×N 个短命对象
  const out = useRef<InsoleAnchorPoint[]>([]);
  const tmp = useRef(new THREE.Vector3());
  const flat = useRef<number[]>([]);
  const payload = useRef<InsoleProjection>({
    points: [], hull: [], hullLen: 0, hullCx: 0, hullCy: 0, restLeft: 0, restRight: 0,
  });
  const centroid = useRef<number[]>([0, 0]);

  /** 支撑点的**世界**坐标：转的是相机不是模型，只在几何/摆位变化时算一次 */
  const worldSupport = useMemo(() => {
    if (!support) return null;
    // 与上屏时同一套变换：mm 几何 → 缩放 → 绕 X 转 −90° → 沿 X 平移（见 <mesh>）
    const m = new THREE.Matrix4()
      .makeTranslation(positionX, 0, 0)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(SCENE_SCALE, SCENE_SCALE, SCENE_SCALE));
    const v = new THREE.Vector3();
    const w = new Float32Array(support.length);
    for (let i = 0; i < support.length; i += 3) {
      v.set(support[i], support[i + 1], support[i + 2]).applyMatrix4(m);
      w[i] = v.x;
      w[i + 1] = v.y;
      w[i + 2] = v.z;
    }
    return w;
  }, [support, positionX]);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    const cb = cbRef.current;
    if (!mesh || !locals || !cb) return;

    // ⚠ 必须先刷新相机矩阵：useFrame 跑在渲染之前，camera.position 已是这一帧的新值，
    // 但 matrixWorldInverse 还是上一帧的 —— 不刷新就等于用旧机位投新坐标，旋转时圆点会脱离模型。
    camera.updateMatrixWorld();
    if (out.current.length !== locals.length) {
      out.current = locals.map((l) => ({ id: l.id, x: 0, y: 0 }));
    }

    const toPxX = (ndcX: number) => ((ndcX + 1) / 2) * size.width;
    const toPxY = (ndcY: number) => ((1 - ndcY) / 2) * size.height;

    for (let i = 0; i < locals.length; i++) {
      tmp.current.copy(locals[i].v).applyMatrix4(mesh.matrixWorld).project(camera);
      const o = out.current[i];
      o.id = locals[i].id;
      o.x = toPxX(tmp.current.x);
      o.y = toPxY(tmp.current.y);
    }

    // 投影轮廓：支撑点 → 屏幕 → 凸包 → 外扩
    let hullLen = 0;
    if (support) {
      const n = support.length / 3;
      for (let i = 0; i < n; i++) {
        tmp.current
          .set(support[i * 3], support[i * 3 + 1], support[i * 3 + 2])
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);
        flat.current[i * 2] = toPxX(tmp.current.x);
        flat.current[i * 2 + 1] = toPxY(tmp.current.y);
      }
      hullLen = convexHull(flat.current, n, payload.current.hull);
      expandHull(payload.current.hull, hullLen, HULL_CLEAR);
      hullCentroid(payload.current.hull, hullLen, centroid.current);
    }

    const p = payload.current;
    p.points = out.current;
    p.hullLen = hullLen;
    p.hullCx = centroid.current[0];
    p.hullCy = centroid.current[1];

    // 旋转不变包络：支点恒投在画布横向正中，包络以正中对称展开
    p.restLeft = 0;
    p.restRight = 0;
    if (worldSupport && size.width && size.height) {
      const t = controls?.target;
      const tx = t?.x ?? 0;
      const ty = t?.y ?? 0;
      const tz = t?.z ?? 0;
      const dist = Math.hypot(camera.position.x - tx, camera.position.y - ty, camera.position.z - tz);
      // (画布高/2)/tan(fov/2)：透视投影矩阵的 [5] 就是 1/tan(fov/2)
      const focalPx = (size.height / 2) * camera.projectionMatrix.elements[5];
      const half = envelopeHalfWidth(worldSupport, tx, ty, tz, dist, focalPx);
      if (Number.isFinite(half)) {
        p.restLeft = size.width / 2 - half;
        p.restRight = size.width / 2 + half;
      }
    }
    cb(p);
  });
}

// ============ 几何体加载（按 样式+脚 缓存） ============

interface LoadedGeo {
  geometry: THREE.BufferGeometry;
  base: BaseDims;
}

const geoCache: Record<string, LoadedGeo> = {}; // key: `${style}:${foot}`
const pairPromise: Record<string, Promise<void>> = {}; // 成品垫整文件去重加载

function fetchBuffer(url: string, onProgress?: (pct: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 120000; // 成品垫可达数十 MB，放宽超时
    xhr.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 90));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.response)
        : reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.ontimeout = () => reject(new Error('加载超时'));
    xhr.send();
  });
}

async function loadFootGeometry(
  style: InsoleStyle,
  foot: 'left' | 'right',
  onProgress?: (pct: number) => void,
): Promise<LoadedGeo> {
  const key = `${style}:${foot}`;
  if (geoCache[key]) {
    onProgress?.(100);
    return geoCache[key];
  }

  const def = STYLE_DEFS[style];

  if (def.kind === 'split') {
    const url = foot === 'left' ? def.left! : def.right!;
    const buffer = await fetchBuffer(url, onProgress);
    const geometry = new STLLoader().parse(buffer);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const base = centerGeometry(geometry);
    onProgress?.(100);
    geoCache[key] = { geometry, base };
    return geoCache[key];
  }

  // 成品垫：整文件只加载/拆分一次，左右一并入缓存
  const pkey = `pair:${style}`;
  if (!pairPromise[pkey]) {
    pairPromise[pkey] = (async () => {
      const buffer = await fetchBuffer(def.url!, onProgress);
      const whole = new STLLoader().parse(buffer);
      const { left, right } = splitProductPair(whole);
      whole.dispose();
      const lb = centerGeometry(left);
      const rb = centerGeometry(right);
      geoCache[`${style}:left`] = { geometry: left, base: lb };
      geoCache[`${style}:right`] = { geometry: right, base: rb };
    })();
  }
  try {
    await pairPromise[pkey];
  } catch (err) {
    delete pairPromise[pkey]; // 失败允许重试
    throw err;
  }
  onProgress?.(100);
  return geoCache[key];
}

// ============ 鞋壳加载（按 来源+脚 缓存，与鞋垫同一套去重写法） ============

const shellCache: Record<string, LoadedShell> = {}; // key: `${sourceId}:${foot}`
const shellPairPromise: Record<string, Promise<void>> = {};
const shellInfoCache: Record<string, ShellPairInfo> = {};

/**
 * 上传件动辄几十上百 MB，换一个就把上一个的几何释放掉，只留内置件与当前件，
 * 否则连传几个鞋壳会把显存/内存堆满。
 */
function pruneShellCache(keepId: string) {
  for (const key of Object.keys(shellCache)) {
    const id = key.slice(0, key.lastIndexOf(':'));
    if (id === keepId || id === BUILTIN_SHELL.id) continue;
    shellCache[key].geometry.dispose();
    delete shellCache[key];
    delete shellPairPromise[`pair:${id}`];
    delete shellInfoCache[id];
  }
}

async function loadShellFoot(
  source: ShellSource,
  foot: 'left' | 'right',
  onProgress?: (pct: number) => void,
): Promise<LoadedShell> {
  const key = `${source.id}:${foot}`;
  if (shellCache[key]) {
    onProgress?.(100);
    return shellCache[key];
  }

  const pkey = `pair:${source.id}`;
  if (!shellPairPromise[pkey]) {
    shellPairPromise[pkey] = (async () => {
      const buffer = source.buffer ?? (await fetchBuffer(source.url!, onProgress));
      // buildShellPair 是同步重活（内置件 168 万面），先让出一帧把「正在加载鞋壳」画出来
      onProgress?.(92);
      await new Promise((r) => setTimeout(r, 30));
      const { left, right, info } = buildShellPair(buffer, source.preOriented);
      shellCache[`${source.id}:left`] = left;
      shellCache[`${source.id}:right`] = right;
      shellInfoCache[source.id] = info;
    })();
  }
  try {
    await shellPairPromise[pkey];
  } catch (err) {
    delete shellPairPromise[pkey]; // 失败允许重试
    throw err;
  }
  onProgress?.(100);
  return shellCache[key];
}

// ============ 几何体准备（克隆 + 缩放） ============

function prepareGeometry(
  sourceGeometry: THREE.BufferGeometry,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): THREE.BufferGeometry {
  const geometry = sourceGeometry.clone();
  geometry.scale(scaleX, scaleY, scaleZ);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

// ============ 单只鞋垫 ============

function SingleStlInsole({
  loaded,
  style,
  params,
  deform,
  color,
  positionX,
  firmness,
  foot,
  heatmap,
  anchors,
  onAnchorProject,
}: {
  loaded: LoadedGeo;
  style: InsoleStyle;
  params: StlInsoleParams;
  /** 顶面隆起量(mm)：仅成品垫(proportional)生效，相对标准成品垫原生几何 */
  deform: DeformMm;
  color: string;
  positionX: number;
  /** 软硬观感 0..1（0=最软/通透胶感，1=最硬/更实哑光）；由 Shore A 得出 */
  firmness: number;
  /** 左右脚：足弓支撑偏内侧，方向由此决定 */
  foot: 'left' | 'right';
  /** 热力上色开关：成品垫按定制位移量，标准垫按相对基准厚度的型面起伏 */
  heatmap: boolean;
  /** 「对比前后」标注锚点；传了就每帧把画布像素坐标回调出去 */
  anchors?: InsoleAnchor[];
  onAnchorProject?: (p: InsoleProjection) => void;
}) {
  // 三款都注入着色器：标准垫的 deform 恒为 ZERO_DEFORM（personalDeform 对 param 返回零），
  // 几何一点不动，注入只为拿到热力上色。
  const isStd = STYLE_DEFS[style].heightMode === 'param';
  const heatMode = isStd ? 1 : 0;

  const scales = useMemo(
    () =>
      computeScales(loaded.base, style, {
        footLengthCm: params.footLength,
        footWidthCm: params.footWidth,
        baseThicknessCm: params.baseThickness,
        archCorrectionMm: params.archCorrection,
        heelThicknessMm: params.heelThickness,
      }),
    [loaded.base, style, params.footLength, params.footWidth, params.baseThickness, params.archCorrection, params.heelThickness],
  );

  const preparedGeometry = useMemo(
    () => prepareGeometry(loaded.geometry, scales.x, scales.y, scales.z),
    [loaded.geometry, scales.x, scales.y, scales.z],
  );

  // 变形/热力着色器 uniforms（对象引用稳定，改 .value 即时生效，不触发重编译）
  const uniforms = useRef({
    uYMin: { value: 0 }, uYRange: { value: 1 }, uZMid: { value: 0 }, uZTop: { value: 1 },
    uXMin: { value: 0 }, uXRange: { value: 1 }, uMedialSign: { value: 1 },
    uArchMm: { value: 0 }, uHeelMm: { value: 0 }, uBaseMm: { value: 0 },
    uHeatMode: { value: 0 }, uBaseThickMm: { value: 0 },
    uHeatOn: { value: 0 },
    uHeatMaxMm: { value: HEAT_MAX_MM },
    uHeatNeg: { value: new THREE.Color(HEAT_COLORS.neg) },
    uHeatMid: { value: new THREE.Color(HEAT_COLORS.mid) },
    uHeatPos: { value: new THREE.Color(HEAT_COLORS.pos) },
  });

  // 几何变化时刷新包围盒相关 uniforms
  useEffect(() => {
    const b = preparedGeometry.boundingBox!;
    const { zMid, zTop } = topWeightBounds(preparedGeometry);
    // 足长归一从鞋垫本体起点算，尾端小舌头不参与（见 lengthNorm）
    const { yStart, yRange } = lengthNorm(preparedGeometry, style);
    uniforms.current.uYMin.value = yStart;
    uniforms.current.uYRange.value = yRange;
    uniforms.current.uXMin.value = b.min.x;
    uniforms.current.uXRange.value = (b.max.x - b.min.x) || 1;
    uniforms.current.uZMid.value = zMid;
    uniforms.current.uZTop.value = zTop;
  }, [preparedGeometry, style]);

  // 左右脚决定足弓内侧方向
  useEffect(() => {
    uniforms.current.uMedialSign.value = medialSign(foot);
  }, [foot]);

  // 厚度增量变化时刷新位移 uniforms（实时，无重建）
  useEffect(() => {
    uniforms.current.uArchMm.value = deform.archMm;
    uniforms.current.uHeelMm.value = deform.heelMm;
    uniforms.current.uBaseMm.value = deform.baseMm;
  }, [deform.archMm, deform.heelMm, deform.baseMm]);

  // 热力口径：标准垫按「相对基准厚度（那层平底板）的起伏」= z − 基础厚度，默认即有颜色。
  // 已知取舍见 DEFORM_GLSL 注释：调大基础厚度时下半部分会变蓝。
  useEffect(() => {
    uniforms.current.uHeatMode.value = heatMode;
    uniforms.current.uBaseThickMm.value = params.baseThickness * 10;
    uniforms.current.uHeatMaxMm.value = isStd ? HEAT_MAX_STD_MM : HEAT_MAX_MM;
  }, [heatMode, isStd, params.baseThickness]);

  // 热力开关：用 uniform 而非 #define —— 着色器源码不变，
  // customProgramCacheKey 的固定键继续有效，切换不引发重编译。
  useEffect(() => {
    uniforms.current.uHeatOn.value = heatmap ? 1 : 0;
  }, [heatmap]);

  // 材质：按软硬观感在「通透胶感 ↔ 更实哑光」间插值（纯渲染，不改几何/数值）。
  const material = useMemo(() => {
    const t = Math.max(0, Math.min(1, firmness));
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      metalness: 0.0,
      roughness: 0.45 + 0.5 * t, // 软 0.45 光滑 → 硬 0.95 哑光
      clearcoat: 0.7 * (1 - t), // 软 0.7 胶感 → 硬 0 无清漆
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.25 - 0.07 * t,
      // 成品晶格垫源网格法线朝向不一致，FrontSide 会剔除翻反的面→网页看着悬空/镂空。
      // 双面渲染避免背面被剔除（几何本身在切片软件里是好的，仅预览渲染问题）。
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms.current);
      // 顶点：算位移 → 抬顶面，同时把上色量写进 varying 交给片元着色器
      shader.vertexShader =
        DEFORM_UNIFORM_DECL + HEAT_VARYING_DECL +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n' + DEFORM_GLSL,
        );
      // 片元：热力模式下按毫米数整体替换固有色
      shader.fragmentShader =
        HEAT_UNIFORM_DECL + HEAT_VARYING_DECL +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' + HEAT_FRAGMENT_GLSL,
        );
    };
    mat.customProgramCacheKey = () => 'insole-deform';
    return mat;
  }, [color, firmness]);

  useEffect(() => {
    return () => {
      preparedGeometry.dispose();
      material.dispose();
    };
  }, [preparedGeometry, material]);

  const meshRef = useRef<THREE.Mesh>(null);
  useAnchorProjection(
    meshRef, loaded.geometry, preparedGeometry, style, deform, foot,
    anchors, onAnchorProject, positionX,
  );

  return (
    <group position={[positionX, 0, 0]}>
      <mesh
        ref={meshRef}
        geometry={preparedGeometry}
        material={material}
        scale={[SCENE_SCALE, SCENE_SCALE, SCENE_SCALE]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={0}
        castShadow
        receiveShadow
      />
    </group>
  );
}

// ============ 单只鞋壳 ============

/**
 * 鞋壳网格。与鞋垫不同，这里【不克隆几何】—— 鞋垫要注入形变着色器才必须克隆，
 * 鞋壳没有形变，克隆 168 万面纯属浪费；缩放放在 mesh.scale 上。
 *
 * 层级：外层 group 负责「mm 局部帧 → 场景帧」（先 ×0.01 再绕 X 转 −90°），
 * 内层 mesh 的 position/rotation/scale 全部在 mm 局部帧里表达，
 * 摆位偏移直接用 computeShellPlacement 的毫米数，不用手工换算到世界轴。
 */
function ShellMesh({
  loaded,
  params,
  adjust,
  opacity,
  solid,
  positionX,
}: {
  loaded: LoadedShell;
  params: StlInsoleParams;
  adjust: ShellAdjust;
  opacity: number;
  /** 「仅鞋壳」态：实心不透明，看整只鞋的外形 */
  solid: boolean;
  positionX: number;
}) {
  const placement = useMemo(
    () =>
      computeShellPlacement(
        loaded.base,
        { footLengthCm: params.footLength, footWidthCm: params.footWidth },
        adjust,
      ),
    [loaded.base, params.footLength, params.footWidth, adjust],
  );

  const { rotation, liftMm } = useMemo(
    () => shellAdjustTransform(adjust, placement.scaledHeiMm),
    [adjust, placement.scaledHeiMm],
  );

  // depthWrite=false：半透明鞋壳不写深度，里面的鞋垫才透得出来。
  // DoubleSide 与鞋垫同理——源网格法线朝向不保证一致，单面渲染会出现镂空。
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(SHELL_COLOR),
        metalness: 0.0,
        roughness: 0.38,
        clearcoat: 0.5,
        clearcoatRoughness: 0.25,
        envMapIntensity: 0.25,
        side: THREE.DoubleSide,
        transparent: !solid,
        opacity: solid ? 1 : opacity,
        depthWrite: solid,
      }),
    [solid, opacity],
  );

  useEffect(() => () => material.dispose(), [material]);

  return (
    <group position={[positionX, 0, 0]}>
      <group rotation={[-Math.PI / 2, 0, 0]} scale={SCENE_SCALE}>
        <mesh
          geometry={loaded.geometry}
          material={material}
          scale={[placement.scale.x, placement.scale.y, placement.scale.z]}
          rotation={rotation}
          position={[
            placement.offsetMm.x,
            placement.offsetMm.y,
            placement.offsetMm.z + liftMm,
          ]}
          renderOrder={1}
          castShadow={solid}
          receiveShadow={solid}
        />
      </group>
    </group>
  );
}

/** 软硬观感 0..1：Shore A(20-60) 归一化 */
function calcFirmness(params: StlInsoleParams): number {
  return Math.max(0, Math.min(1, (params.hardness - 20) / 40));
}

// ============ 定制形变色标图例 ============

/**
 * 色条渐变与着色器共用 HEAT_COLORS 同一份色值，杜绝两处漂移。
 * 文字用页面墨色而非色标色——语义不靠颜色单独承载。
 */
function HeatLegend() {
  return (
    <div className="absolute bottom-2" style={{ right: '72px' }}>
      <div style={{ fontSize: '11px', color: '#303E5A', fontWeight: 600, marginBottom: '6px' }}>
        定制量
      </div>
      {/* 竖排色标：上红(加厚) → 中性 → 下蓝(减薄) */}
      <div style={{ display: 'flex', gap: '7px', alignItems: 'stretch' }}>
        <div
          style={{
            width: '10px',
            height: '96px',
            borderRadius: '5px',
            background: `linear-gradient(180deg, ${HEAT_COLORS.pos}, ${HEAT_COLORS.mid}, ${HEAT_COLORS.neg})`,
          }}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            fontSize: '10px',
            color: '#757c8a',
            whiteSpace: 'nowrap',
          }}
        >
          <span>加厚</span>
          <span>0</span>
          <span>减薄</span>
        </div>
      </div>
    </div>
  );
}

// ============ 3D 场景 ============

function InsoleScene({
  activeFoot,
  autoRotate,
  color,
  style,
  leftParams,
  rightParams,
  leftDeform,
  rightDeform,
  leftGeo,
  rightGeo,
  heatmap,
  shellView,
  shellOpacity,
  shellAdjust,
  shellLeft,
  shellRight,
  anchors,
  onAnchorProject,
}: {
  activeFoot: 'left' | 'right' | 'both';
  autoRotate: boolean;
  color: string;
  style: InsoleStyle;
  leftParams: StlInsoleParams;
  rightParams: StlInsoleParams;
  leftDeform: DeformMm;
  rightDeform: DeformMm;
  leftGeo: LoadedGeo | null;
  rightGeo: LoadedGeo | null;
  heatmap: boolean;
  shellView: ShellView;
  shellOpacity: number;
  shellAdjust: ShellAdjust;
  shellLeft: LoadedShell | null;
  shellRight: LoadedShell | null;
  anchors?: InsoleAnchor[];
  onAnchorProject?: (p: InsoleProjection) => void;
}) {
  const spacing = 1.6;
  const showInsole = shellView !== 'only';
  const showShell = shellView !== 'off';
  const solidShell = shellView === 'only';

  /**
   * 相机距离按画布宽高比反推，保证内容横向装得下。
   *
   * fov 是【纵向】视角，横向可见宽度 = 2·dist·tan(fov/2)·aspect —— 画布越窄横向越吃紧。
   * 双脚并排（activeFoot='both'）横向需求最大：间距 1.6 + 一只垫子约 1.0（100mm×0.01）。
   * 页面上的取景器很宽（aspect≈1.6）够用，下载弹窗里只有 ~540×540（aspect≈1.0），
   * 同样的距离下两只垫子就顶出画布、越过弹窗边框。取「基准距离」与「装得下所需距离」的大者：
   * 宽画布保持原样、窄画布自动后退。
   */
  const { size } = useThree();
  const camPos = useMemo<[number, number, number]>(() => {
    // 单只鞋垫时相机拉近 15%：方案页舞台是宽扁画布，按双脚距离取景一只垫子只占中间一小块；
    // 双脚（下载弹窗）保持原距离，两只并排本来就贴边
    const near = activeFoot === 'both' ? 1 : 0.85;
    const BASE: [number, number, number] = [0, 3.0 * near, 3.5 * near];
    const baseDist = Math.hypot(BASE[1], BASE[2]);
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 16 / 9;
    // 需覆盖的横向半宽（场景单位）。含鞋壳时整只鞋比垫子宽，留更多余量
    const halfFoot = showShell ? 0.95 : 0.75;
    const halfNeed = activeFoot === 'both' ? spacing / 2 + halfFoot : halfFoot;
    // 上限 9.8 < OrbitControls 的 maxDistance(10)，否则控件会在首帧把相机拉回来、白算一次
    const fit = halfNeed / (Math.tan((35 / 2) * (Math.PI / 180)) * aspect);
    const dist = Math.min(9.8, Math.max(baseDist, fit));
    const k = dist / baseDist;
    return [0, BASE[1] * k, BASE[2] * k];
  }, [activeFoot, showShell, size.width, size.height]);
  // 「左右互换」：自动手性判反时把两只对调，零成本
  const shellFor = (foot: 'left' | 'right') => {
    const useRight = shellAdjust.swapLR ? foot === 'left' : foot === 'right';
    return useRight ? shellRight : shellLeft;
  };

  return (
    <>
      <PerspectiveCamera makeDefault position={camPos} fov={35} />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={2}
        maxDistance={10}
      />

      {/* 纯本地灯光（不依赖外网 HDR 环境贴图） */}
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#ffffff', '#b9bec6', 0.6]} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
      />
      <directionalLight position={[-3, 5, -3]} intensity={0.45} />
      <directionalLight position={[0, 2, -5]} intensity={0.3} />

      <Suspense fallback={null}>
        {showInsole && (activeFoot === 'left' || activeFoot === 'both') && leftGeo && (
          <SingleStlInsole
            loaded={leftGeo}
            style={style}
            params={leftParams}
            deform={leftDeform}
            color={color}
            positionX={activeFoot === 'both' ? -spacing / 2 : 0}
            firmness={calcFirmness(leftParams)}
            foot="left"
            heatmap={heatmap}
            anchors={activeFoot === 'left' ? anchors : undefined}
            onAnchorProject={activeFoot === 'left' ? onAnchorProject : undefined}
          />
        )}

        {showInsole && (activeFoot === 'right' || activeFoot === 'both') && rightGeo && (
          <SingleStlInsole
            loaded={rightGeo}
            style={style}
            params={rightParams}
            deform={rightDeform}
            color={color}
            positionX={activeFoot === 'both' ? spacing / 2 : 0}
            firmness={calcFirmness(rightParams)}
            foot="right"
            heatmap={heatmap}
            anchors={activeFoot === 'right' ? anchors : undefined}
            onAnchorProject={activeFoot === 'right' ? onAnchorProject : undefined}
          />
        )}

        {/* 鞋壳画在鞋垫之后：半透明材质由 three 自动排到不透明物体后面渲染 */}
        {showShell && (activeFoot === 'left' || activeFoot === 'both') && shellFor('left') && (
          <ShellMesh
            loaded={shellFor('left')!}
            params={leftParams}
            adjust={shellAdjust}
            opacity={shellOpacity}
            solid={solidShell}
            positionX={activeFoot === 'both' ? -spacing / 2 : 0}
          />
        )}

        {showShell && (activeFoot === 'right' || activeFoot === 'both') && shellFor('right') && (
          <ShellMesh
            loaded={shellFor('right')!}
            params={rightParams}
            adjust={shellAdjust}
            opacity={shellOpacity}
            solid={solidShell}
            positionX={activeFoot === 'both' ? spacing / 2 : 0}
          />
        )}

        <ContactShadows position={[0, -0.01, 0]} opacity={0.3} scale={8} blur={2} far={3} />
      </Suspense>

      {/* 地面网格已统一取消，仅保留接触阴影 */}
    </>
  );
}

// ============ 类型定义 ============

export interface StlInsoleParams {
  footLength: number;
  footWidth: number;
  archCorrection: number;
  archLevel: number;
  archType: string;
  baseThickness: number;
  pressureRatio: number;
  heelThickness: number;
  latticeDensity: number;
  /** 整垫软硬（邵氏硬度 Shore A） */
  hardness: number;
}

interface StlInsoleViewerProps {
  activeFoot: 'left' | 'right' | 'both';
  /** 鞋垫样式：舒缓 / 运动 / 标准 */
  style?: InsoleStyle;
  autoRotate?: boolean;
  color?: string;
  leftParams: StlInsoleParams;
  rightParams: StlInsoleParams;
  /** 顶面隆起增量(mm)，仅成品垫生效；不传则不变形 */
  leftDeform?: DeformMm;
  rightDeform?: DeformMm;
  onLoadError?: (error: string) => void;
  /** 鞋壳来源：内置件或上传件；不传即无鞋壳 */
  shellSource?: ShellSource | null;
  /** 鞋壳三态；'off' 时完全不加载鞋壳文件（内置件 83MB，必须懒加载） */
  shellView?: ShellView;
  /** 装配态鞋壳不透明度 0..1 */
  shellOpacity?: number;
  /** 上传件摆位手动微调 */
  shellAdjust?: ShellAdjust;
  /** 鞋壳解析完成后回传（双脚/单只、手性置信度、面数），供页面提示 */
  onShellInfo?: (info: ShellPairInfo) => void;
  onShellError?: (error: string) => void;
  /** 「定制对比」热力图是否默认打开（仅决定初始值，用户仍可用右上角按钮切换） */
  defaultHeatmap?: boolean;
  /**
   * 受控热力图开关：传了就由父组件说了算，画布右上那枚自带按钮同时隐藏。
   * 方案页把开关搬到了画布左下角的「对比前后」按钮上，两处都画会出现两个都能点、状态各说各话的开关。
   * 不传则维持组件自带按钮 + 内部状态（下载弹窗等处照旧）。
   */
  heatmap?: boolean;
  /**
   * 要投到屏幕上的标注锚点（「对比前后」的引线落点），与 onAnchorProject 配对。
   * 传了就每帧把锚点的画布像素坐标回调出去，画什么由父组件决定（InsoleCompareOverlay）。
   */
  anchors?: InsoleAnchor[];
  /** 每帧回调（约 60 次/秒）。⚠ 回调里【不要 setState】，直接改 DOM/SVG 属性 */
  onAnchorProject?: (p: InsoleProjection) => void;
  /** 隐藏画布内自带的色标图例（对比态下图例画在覆盖层里，两个会并存） */
  hideLegend?: boolean;
}

// ============ 主组件 ============

export function StlInsoleViewer({
  activeFoot,
  style = 'comfort',
  autoRotate = false,
  color = '#B0B0B0',
  leftParams,
  rightParams,
  leftDeform = ZERO_DEFORM,
  rightDeform = ZERO_DEFORM,
  onLoadError,
  shellSource = null,
  shellView = 'off',
  shellOpacity = 0.35,
  shellAdjust = DEFAULT_SHELL_ADJUST,
  onShellInfo,
  onShellError,
  defaultHeatmap = false,
  heatmap: heatmapProp,
  anchors,
  onAnchorProject,
  hideLegend = false,
}: StlInsoleViewerProps) {
  const [leftGeo, setLeftGeo] = useState<LoadedGeo | null>(null);
  const [rightGeo, setRightGeo] = useState<LoadedGeo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  // 定制形变热力图：受控（父组件传 heatmap）优先；否则初始值由 defaultHeatmap 决定、自带按钮切换
  const [heatmapSelf, setHeatmap] = useState(defaultHeatmap);
  const heatControlled = heatmapProp !== undefined;
  const heatmap = heatControlled ? heatmapProp : heatmapSelf;

  // 鞋壳状态独立于鞋垫：加载中/失败都不能顶掉已经画好的鞋垫
  const [shellLeft, setShellLeft] = useState<LoadedShell | null>(null);
  const [shellRight, setShellRight] = useState<LoadedShell | null>(null);
  const [shellLoading, setShellLoading] = useState(false);
  const [shellProgress, setShellProgress] = useState(0);
  const [shellError, setShellError] = useState<string | null>(null);
  const [shellRetry, setShellRetry] = useState(0);
  // 回调放 ref：父组件常传内联函数，进依赖数组会让 83MB 的加载反复重跑
  const shellCbRef = useRef({ onShellInfo, onShellError });
  shellCbRef.current = { onShellInfo, onShellError };

  // 仅成品垫走变形着色器；标准垫是整体 Z 缩放，形变均匀、热力图无信息量
  // 三款都可看：成品垫是定制位移量，标准垫是型面相对基准厚度的起伏
  const heatOn = heatmap;

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setProgress(0);

      const left = await loadFootGeometry(style, 'left', (pct) => setProgress(Math.round(pct * 0.5)));
      const right = await loadFootGeometry(style, 'right', (pct) => setProgress(50 + Math.round(pct * 0.5)));

      setLeftGeo(left);
      setRightGeo(right);
      setLoading(false);
      setProgress(100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误';
      console.error('STL模型加载失败:', msg);
      setError(msg);
      setLoading(false);
      onLoadError?.(msg);
    }
  }, [style, onLoadError]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleRetry = useCallback(() => {
    delete geoCache[`${style}:left`];
    delete geoCache[`${style}:right`];
    delete pairPromise[`pair:${style}`];
    setRetryCount((c) => c + 1);
    loadModels();
  }, [loadModels, style]);

  // 鞋壳懒加载：'off' 时一个字节都不拉
  const shellOn = shellView !== 'off' && shellSource != null;
  const shellId = shellSource?.id ?? '';
  useEffect(() => {
    if (!shellOn || !shellSource) {
      setShellLeft(null);
      setShellRight(null);
      setShellError(null);
      setShellLoading(false);
      return;
    }
    let cancelled = false;
    pruneShellCache(shellSource.id);
    setShellLoading(true);
    setShellError(null);
    setShellProgress(0);
    (async () => {
      try {
        const l = await loadShellFoot(shellSource, 'left', (p) => {
          if (!cancelled) setShellProgress(p);
        });
        const r = await loadShellFoot(shellSource, 'right');
        if (cancelled) return;
        setShellLeft(l);
        setShellRight(r);
        setShellLoading(false);
        setShellProgress(100);
        const info = shellInfoCache[shellSource.id];
        if (info) shellCbRef.current.onShellInfo?.(info);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '未知错误';
        console.error('鞋壳模型加载失败:', msg);
        setShellError(msg);
        setShellLoading(false);
        shellCbRef.current.onShellError?.(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
    // shellSource 对象每次渲染可能是新引用，按 id 判定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellOn, shellId, shellRetry]);

  const handleShellRetry = useCallback(() => {
    if (!shellSource) return;
    delete shellCache[`${shellSource.id}:left`];
    delete shellCache[`${shellSource.id}:right`];
    delete shellPairPromise[`pair:${shellSource.id}`];
    setShellRetry((c) => c + 1);
  }, [shellSource]);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-lg">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">正在加载鞋垫模型...</div>
        <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">{progress}%</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-lg">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <div className="text-sm text-destructive font-medium">模型加载失败</div>
        <div className="text-xs text-muted-foreground max-w-xs text-center">{error}</div>
        <button className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1" onClick={handleRetry}>
          <RefreshCw className="w-3.5 h-3.5" />
          点击重试 {retryCount > 0 ? `(${retryCount})` : ''}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <Canvas shadows dpr={[1, 1.5]}>
        <InsoleScene
          activeFoot={activeFoot}
          autoRotate={autoRotate}
          color={color}
          style={style}
          leftParams={leftParams}
          rightParams={rightParams}
          leftDeform={leftDeform}
          rightDeform={rightDeform}
          leftGeo={leftGeo}
          rightGeo={rightGeo}
          heatmap={heatOn}
          shellView={shellView}
          shellOpacity={shellOpacity}
          shellAdjust={shellAdjust}
          shellLeft={shellLeft}
          shellRight={shellRight}
          anchors={anchors}
          onAnchorProject={onAnchorProject}
        />
      </Canvas>

      {/* 鞋壳状态条：画布内小提示，不顶掉已经画好的鞋垫 */}
      {shellOn && shellLoading && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: 'rgba(255,255,255,0.92)', color: '#303E5A', border: '1px solid rgba(180,195,225,0.55)' }}
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          正在加载鞋壳… {shellProgress}%
        </div>
      )}

      {shellOn && shellError && (
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: 'rgba(255,255,255,0.92)', color: '#b3261e', border: '1px solid rgba(179,38,30,0.35)' }}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          鞋壳加载失败：{shellError}
          <button type="button" className="underline" onClick={handleShellRetry}>
            重试
          </button>
        </div>
      )}

      <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
        ◆ 左键: 旋转 · 右键: 平移 · 滚轮: 缩放
      </div>

      {/* 「仅鞋壳」态看不到鞋垫，定制对比无从谈起。受控时按钮在父组件那边，这里不再画第二枚 */}
      {shellView !== 'only' && !heatControlled && (
        <button
          type="button"
          onClick={() => setHeatmap((v) => !v)}
          aria-pressed={heatOn}
          className="absolute top-2 right-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
          style={{
            background: heatOn ? '#00359F' : 'rgba(255,255,255,0.92)',
            color: heatOn ? '#fff' : '#303E5A',
            border: '1px solid rgba(180,195,225,0.55)',
          }}
        >
          <Layers className="w-3.5 h-3.5" />
          定制对比
        </button>
      )}

      {heatOn && shellView !== 'only' && !hideLegend && <HeatLegend />}
    </div>
  );
}

export default StlInsoleViewer;
