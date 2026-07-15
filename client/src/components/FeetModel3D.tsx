import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const ce = React.createElement;
const MODEL_URL = "/assets/models/feet-3d-model.glb";
const LOCKED_VIEW_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];
// 站姿（足弓分析视图）：脚立在地面、正对观察者看到脚背的角度（可微调）
// 正角度=脚向下前翻、脚背朝向观察者（负方向会露出脚底）
const STANDING_ROT_X = Math.PI * 0.1;
// pose 旋转过渡速度（指数趋近系数，60fps 下的近似总时长）：
// 0.10≈0.7s ｜ 0.13≈0.55s ｜ 0.18≈0.4s ｜ 0.25≈0.27s —— 越大越快
const POSE_TRANSITION_K = 0.13;

useGLTF.preload(MODEL_URL);

// ============ 实时热力图叠加：对齐旋钮（对着效果调这里）============
const HEATMAP = {
  vmax: 110, // 颜色映射上限（越小低压也更鲜艳）
  upAxis: "y" as "x" | "y" | "z", // 脚底法线所在轴（朝相机的方向）
  soleSide: "min" as "min" | "max", // 脚底在该轴的 min 还是 max 端
  lift: 0.03, // 抬离脚底一点，避免与网格 z-fighting
  padScale: 0.96, // 平面相对单只脚包围盒的缩放（略小于脚模，四周留边，避免脚趾端被裁掉）
  swapFeet: false, // 左右脚数据对调（若贴反了改这里）
  transpose: true, // 是否转置原始帧（与 2D 网格一致：display[r][c]=raw[c][r]）
  flipU: false, // 纹理左右翻转
  flipV: false, // 纹理上下翻转
  rotateDeg: 0, // 纹理旋转 0/90/180/270
  opacity: 1, // 整体不透明度
  blurPx: 1, // 额外 CSS 模糊（平滑主要靠数据高斯+插值，这里几乎不用）
  upsample: 8, // 双线性上采样倍数
};

// 与左侧 colorbar 一致的暖色渐变：低=浅蓝 → 浅绿 → 黄 → 橙 → 红=高
const HEAT_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [107, 203, 255]], // #6bcbff
  [0.39, [209, 255, 164]], // #d1ffa4
  [0.61, [255, 199, 88]], // #ffc758
  [0.81, [255, 132, 0]], // #ff8400
  [1.0, [255, 130, 130]], // #ff8282
];
function heatColorRGB(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (x <= HEAT_STOPS[i][0]) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const [t1, c1] = HEAT_STOPS[i];
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

/** 对数值网格做可分离 box 模糊（多趟 ≈ 高斯），平滑传感噪声 */
function blurField(src: Float32Array, rows: number, cols: number, radius: number, passes: number): Float32Array {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    const h = new Float32Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let cnt = 0;
        for (let d = -radius; d <= radius; d++) {
          const cc = c + d;
          if (cc >= 0 && cc < cols) {
            sum += cur[r * cols + cc];
            cnt++;
          }
        }
        h[r * cols + c] = sum / cnt;
      }
    }
    const v = new Float32Array(rows * cols);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        let sum = 0;
        let cnt = 0;
        for (let d = -radius; d <= radius; d++) {
          const rr = r + d;
          if (rr >= 0 && rr < rows) {
            sum += h[rr * cols + c];
            cnt++;
          }
        }
        v[r * cols + c] = sum / cnt;
      }
    }
    cur = v;
  }
  return cur;
}

/**
 * 由原始帧生成平滑热力图纹理：数据高斯 + 双线性插值，暖色，透明底。
 * colStart/colEnd 指定只渲染某只脚对应的列范围（用于左右分开贴图）。
 */
function buildHeatmapTexture(
  data: number[][] | null,
  colStart?: number,
  colEnd?: number,
  vmax: number = HEATMAP.vmax,
): THREE.CanvasTexture | null {
  if (!data || data.length === 0 || !data[0]) return null;
  const rawRows = data.length;
  const rawCols = data[0].length;
  const rows = HEATMAP.transpose ? rawCols : rawRows;
  const fullCols = HEATMAP.transpose ? rawRows : rawCols;
  const c0 = Math.max(0, colStart ?? 0);
  const c1 = Math.min(fullCols, colEnd ?? fullCols);
  const cols = Math.max(1, c1 - c0);
  const at = (r: number, c: number) => (HEATMAP.transpose ? data[c]?.[r] : data[r]?.[c]) ?? 0;

  // 1) 取值（仅该列范围）
  const rawField = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let lc = 0; lc < cols; lc++) rawField[r * cols + lc] = at(r, c0 + lc);

  // 2) 找有效压力区域的包围盒（脚码自适应：34 码或 43 码都拉伸铺满脚模）
  let rMin = rows, rMax = -1, cMin = cols, cMax = -1;
  for (let r = 0; r < rows; r++) {
    for (let lc = 0; lc < cols; lc++) {
      if (rawField[r * cols + lc] > 0) {
        if (r < rMin) rMin = r;
        if (r > rMax) rMax = r;
        if (lc < cMin) cMin = lc;
        if (lc > cMax) cMax = lc;
      }
    }
  }
  let cropField = rawField;
  let cRows = rows;
  let cCols = cols;
  if (rMax >= rMin && cMax >= cMin) {
    // 各留 1 格呼吸边，裁出足迹子区域
    const pr0 = Math.max(0, rMin - 1);
    const pr1 = Math.min(rows - 1, rMax + 1);
    const pc0 = Math.max(0, cMin - 1);
    const pc1 = Math.min(cols - 1, cMax + 1);
    cRows = pr1 - pr0 + 1;
    cCols = pc1 - pc0 + 1;
    cropField = new Float32Array(cRows * cCols);
    for (let r = 0; r < cRows; r++) {
      for (let lc = 0; lc < cCols; lc++) {
        cropField[r * cCols + lc] = rawField[(pr0 + r) * cols + (pc0 + lc)];
      }
    }
  }

  // 3) 高斯平滑（去噪，形成连续场）
  const sm = blurField(cropField, cRows, cCols, 1, 2);

  // 4) 上色到小画布（暖色 + 按压力给透明度）——用裁剪后的尺寸，足迹拉伸铺满纹理
  const small = document.createElement("canvas");
  small.width = cCols;
  small.height = cRows;
  const sctx = small.getContext("2d");
  if (!sctx) return null;
  const img = sctx.createImageData(cCols, cRows);
  for (let r = 0; r < cRows; r++) {
    for (let c = 0; c < cCols; c++) {
      const v = sm[r * cCols + c];
      const t = Math.max(0, Math.min(1, v / Math.max(1, vmax)));
      const [red, grn, blu] = heatColorRGB(t);
      const o = (r * cCols + c) * 4;
      img.data[o] = red;
      img.data[o + 1] = grn;
      img.data[o + 2] = blu;
      img.data[o + 3] = v <= 0.6 ? 0 : Math.min(255, Math.round(90 + t * 165));
    }
  }
  sctx.putImageData(img, 0, 0);

  // 5) 双线性插值上采样（imageSmoothing），几乎不加 CSS 模糊
  const big = document.createElement("canvas");
  big.width = cCols * HEATMAP.upsample;
  big.height = cRows * HEATMAP.upsample;
  const bctx = big.getContext("2d");
  if (!bctx) return null;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = "high";
  if (HEATMAP.blurPx > 0) bctx.filter = `blur(${HEATMAP.blurPx}px)`;
  bctx.drawImage(small, 0, 0, big.width, big.height);

  const tex = new THREE.CanvasTexture(big);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.center.set(0.5, 0.5);
  tex.rotation = (HEATMAP.rotateDeg * Math.PI) / 180;
  if (HEATMAP.flipU) {
    tex.repeat.x = -1;
    tex.offset.x = 1;
  }
  if (HEATMAP.flipV) {
    tex.repeat.y = -1;
    tex.offset.y = 1;
  }
  tex.needsUpdate = true;
  return tex;
}

// ===== 足弓分区色块纹理（压力/面积分析视图：Python section_coords 贴到脚模） =====
/** 分区集合：[区索引][点索引][r, c]，区顺序 = 趾部/前足/中足/后足 */
export type ZoneSections = number[][][];
// 设计稿取色：趾部蓝紫 / 前足草绿 / 中足金黄 / 后足玫红
const ZONE_FILL = ["#7B96F0", "#5EC878", "#F6BC3F", "#DF567F"];

/** 分区格子的行列范围（含端点） */
export interface ZoneBounds {
  rMin: number;
  rMax: number;
  cMin: number;
  cMax: number;
}

function zoneBoundsOf(sections: ZoneSections): ZoneBounds | null {
  let rMin = Infinity, rMax = -Infinity, cMin = Infinity, cMax = -Infinity;
  sections.forEach((sec) =>
    (sec ?? []).forEach((p) => {
      if (!p || p.length < 2) return;
      const [r, c] = p;
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
      if (c < cMin) cMin = c;
      if (c > cMax) cMax = c;
    }),
  );
  return isFinite(rMin) ? { rMin, rMax, cMin, cMax } : null;
}

/**
 * 等化左右脚 bounds（与原型 InteractiveArchChart.getEqualizedBounds 一致）：
 * 行/列跨度取两脚较大者，小的那只居中扩展 → 两脚格子物理尺寸一致
 */
export function equalizeZoneBounds(
  left: ZoneSections,
  right: ZoneSections,
): { left: ZoneBounds | null; right: ZoneBounds | null } {
  const lb = zoneBoundsOf(left);
  const rb = zoneBoundsOf(right);
  if (!lb || !rb) return { left: lb, right: rb };
  const rows = Math.max(lb.rMax - lb.rMin, rb.rMax - rb.rMin) + 1;
  const cols = Math.max(lb.cMax - lb.cMin, rb.cMax - rb.cMin) + 1;
  const expand = (b: ZoneBounds): ZoneBounds => {
    const rExtra = rows - (b.rMax - b.rMin + 1);
    const cExtra = cols - (b.cMax - b.cMin + 1);
    const rBefore = Math.floor(rExtra / 2);
    const cBefore = Math.floor(cExtra / 2);
    return {
      rMin: b.rMin - rBefore,
      rMax: b.rMax + rExtra - rBefore,
      cMin: b.cMin - cBefore,
      cMax: b.cMax + cExtra - cBefore,
    };
  };
  return { left: expand(lb), right: expand(rb) };
}

/** 把分区格子画成四色方格纹理（透明底、格间留缝）；bounds 可外部传入（左右脚等化后） */
function buildZoneTexture(sections: ZoneSections, forced?: ZoneBounds | null): THREE.CanvasTexture | null {
  if (!sections || sections.length === 0) return null;
  const pts: { r: number; c: number; z: number }[] = [];
  sections.forEach((sec, zi) =>
    (sec ?? []).forEach((p) => {
      if (!p || p.length < 2) return;
      pts.push({ r: p[0], c: p[1], z: zi });
    }),
  );
  if (pts.length === 0) return null;
  const b = forced ?? zoneBoundsOf(sections);
  if (!b) return null;
  const rows = b.rMax - b.rMin + 1;
  const cols = b.cMax - b.cMin + 1;
  const CELL = 40; // 单格像素（高分辨率，保证缩放后依旧锐利）
  const GAP = 4; // 格间缝隙 = 10%（与原型 cellSize=scale*0.9 一致）
  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const { r, c, z } of pts) {
    ctx.fillStyle = ZONE_FILL[z % ZONE_FILL.length];
    ctx.fillRect((c - b.cMin) * CELL + GAP / 2, (r - b.rMin) * CELL + GAP / 2, CELL - GAP, CELL - GAP);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 方格必须保持硬边：禁用插值与 mipmap，否则白缝被糊掉、透明底黑色渗入格子边缘
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 单只脚在视口中的投影矩形（均为容器百分比 0-100） */
export interface FootRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 屏幕点（容器百分比） */
export interface FootPt {
  x: number;
  y: number;
}

/** 单只脚的投影标注数据：包围盒 + 四个真实轮廓切点（趾尖/脚跟/屏幕左右最宽点） */
export interface FootAnno {
  rect: FootRect;
  toe: FootPt;
  heel: FootPt;
  sideL: FootPt;
  sideR: FootPt;
}

function FeetMesh({
  scale,
  lockedView,
  pressureData,
  heatVmax,
  onFootRects,
  pose = "top",
  onPoseSettled,
  zoneSections,
}: {
  scale: number;
  lockedView: boolean;
  pressureData?: number[][] | null;
  heatVmax?: number;
  onFootRects?: (rects: { left: FootAnno; right: FootAnno }) => void;
  pose?: "top" | "standing";
  onPoseSettled?: () => void;
  zoneSections?: { left: ZoneSections; right: ZoneSections } | null;
}) {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => scene.clone(true), [scene]);
  // 模型包围盒（局部空间）：用于居中补偿 + 热力图平面定位
  const bbox = useMemo(() => new THREE.Box3().setFromObject(model), [model]);
  const centerX = useMemo(() => bbox.getCenter(new THREE.Vector3()).x, [bbox]);

  // 每只脚的局部包围盒 + 六个极值顶点（各轴 min/max 的真实轮廓切点），
  // 包围盒用于贴图定位，极值顶点投影后得到趾尖/脚跟/内外侧最宽点的屏幕坐标
  const footBoxes = useMemo(() => {
    model.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const cx = bbox.getCenter(new THREE.Vector3()).x;
    const mkSide = () => ({
      box: new THREE.Box3().makeEmpty(),
      ext: {
        minX: new THREE.Vector3(Infinity, 0, 0),
        maxX: new THREE.Vector3(-Infinity, 0, 0),
        minY: new THREE.Vector3(0, Infinity, 0),
        maxY: new THREE.Vector3(0, -Infinity, 0),
        minZ: new THREE.Vector3(0, 0, Infinity),
        maxZ: new THREE.Vector3(0, 0, -Infinity),
      },
    });
    const left = mkSide();
    const right = mkSide();
    const v = new THREE.Vector3();
    // 第一遍：各脚包围盒
    model.traverse((child: any) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        (v.x < cx ? left : right).box.expandByPoint(v);
      }
    });
    // 第二遍：极值切点。侧向最宽点（minX/maxX）只在"前掌区域"（靠趾尖的前 55%）搜索，
    // 避免命中脚踝内侧凸起（俯视时趾尖在局部 z 的 max 端）
    const zSplit = (b: THREE.Box3) => b.min.z + (b.max.z - b.min.z) * 0.45;
    const zL = zSplit(left.box);
    const zR = zSplit(right.box);
    model.traverse((child: any) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const isLeft = v.x < cx;
        const e = (isLeft ? left : right).ext;
        if (v.z > (isLeft ? zL : zR)) {
          if (v.x < e.minX.x) e.minX.copy(v);
          if (v.x > e.maxX.x) e.maxX.copy(v);
        }
        if (v.y < e.minY.y) e.minY.copy(v);
        if (v.y > e.maxY.y) e.maxY.copy(v);
        if (v.z < e.minZ.z) e.minZ.copy(v);
        if (v.z > e.maxZ.z) e.maxZ.copy(v);
      }
    });
    return { left, right };
  }, [model, bbox]);

  // 把每只脚的包围盒投影到屏幕（容器百分比），供报告页把底衬/尺寸线精确贴合脚模
  const { camera: projCamera, size: viewSize } = useThree();
  useEffect(() => {
    if (!lockedView || !onFootRects) return;
    // 复现渲染用的 group 变换（scale + 居中补偿 + 锁定视角旋转）与模型自身变换
    const G = new THREE.Matrix4().compose(
      new THREE.Vector3(-scale * centerX, -0.05, 0),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(LOCKED_VIEW_ROTATION[0], LOCKED_VIEW_ROTATION[1], LOCKED_VIEW_ROTATION[2]),
      ),
      new THREE.Vector3(scale, scale, scale),
    );
    model.updateMatrix();
    const full = new THREE.Matrix4().multiplyMatrices(G, model.matrix);
    projCamera.updateMatrixWorld();

    const projectPt = (v: THREE.Vector3): FootPt => {
      const p = v.clone().applyMatrix4(full).project(projCamera);
      return { x: ((p.x + 1) / 2) * 100, y: ((1 - p.y) / 2) * 100 };
    };
    const project = (box: THREE.Box3): FootRect => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const p = new THREE.Vector3();
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            p.set(x, y, z).applyMatrix4(full).project(projCamera);
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
      return {
        left: ((minX + 1) / 2) * 100,
        top: ((1 - maxY) / 2) * 100,
        width: ((maxX - minX) / 2) * 100,
        height: ((maxY - minY) / 2) * 100,
      };
    };
    // 六个极值顶点投影后，按屏幕方位挑出四个真实轮廓切点
    const mkAnno = (side: typeof footBoxes.left): FootAnno => {
      const e = side.ext;
      const pts = [e.minX, e.maxX, e.minY, e.maxY, e.minZ, e.maxZ].map(projectPt);
      const toe = pts.reduce((a, b) => (b.y < a.y ? b : a));
      const heel = pts.reduce((a, b) => (b.y > a.y ? b : a));
      const sideL = pts.reduce((a, b) => (b.x < a.x ? b : a));
      const sideR = pts.reduce((a, b) => (b.x > a.x ? b : a));
      return { rect: project(side.box), toe, heel, sideL, sideR };
    };
    onFootRects({ left: mkAnno(footBoxes.left), right: mkAnno(footBoxes.right) });
  }, [lockedView, onFootRects, scale, centerX, model, footBoxes, projCamera, viewSize.width, viewSize.height]);

  // 左右脚各自的热力图纹理（各取一半列范围），并释放旧纹理
  // 分区模式下先等化左右脚 bounds，保证两脚格子物理尺寸一致（同原型）
  const zoneBounds = useMemo(
    () => (zoneSections ? equalizeZoneBounds(zoneSections.left, zoneSections.right) : null),
    [zoneSections],
  );
  const leftTex = useMemo(() => {
    if (!lockedView) return null;
    if (zoneSections) return buildZoneTexture(zoneSections.left, zoneBounds?.left); // 分区色块模式
    const [a, b] = HEATMAP.swapFeet ? [32, 64] : [0, 32];
    return buildHeatmapTexture(pressureData ?? null, a, b, heatVmax ?? HEATMAP.vmax);
  }, [pressureData, lockedView, heatVmax, zoneSections, zoneBounds]);
  const rightTex = useMemo(() => {
    if (!lockedView) return null;
    if (zoneSections) return buildZoneTexture(zoneSections.right, zoneBounds?.right);
    const [a, b] = HEATMAP.swapFeet ? [0, 32] : [32, 64];
    return buildHeatmapTexture(pressureData ?? null, a, b, heatVmax ?? HEATMAP.vmax);
  }, [pressureData, lockedView, heatVmax, zoneSections, zoneBounds]);
  useEffect(() => () => leftTex?.dispose(), [leftTex]);
  useEffect(() => () => rightTex?.dispose(), [rightTex]);

  // 每只脚的热力图平面位置/朝向/尺寸（贴到各自足底）
  const overlays = useMemo(() => {
    const build = (box: THREE.Box3) => {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const pad = HEATMAP.padScale;
      const lift = HEATMAP.lift;
      if (HEATMAP.upAxis === "z") {
        const z = HEATMAP.soleSide === "min" ? box.min.z - lift : box.max.z + lift;
        return {
          position: [center.x, center.y, z] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          args: [size.x * pad, size.y * pad] as [number, number],
        };
      }
      if (HEATMAP.upAxis === "x") {
        const x = HEATMAP.soleSide === "min" ? box.min.x - lift : box.max.x + lift;
        return {
          position: [x, center.y, center.z] as [number, number, number],
          rotation: [0, Math.PI / 2, 0] as [number, number, number],
          args: [size.z * pad, size.y * pad] as [number, number],
        };
      }
      const y = HEATMAP.soleSide === "min" ? box.min.y - lift : box.max.y + lift;
      return {
        position: [center.x, y, center.z] as [number, number, number],
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        args: [size.x * pad, size.z * pad] as [number, number],
      };
    };
    return { left: build(footBoxes.left.box), right: build(footBoxes.right.box) };
  }, [footBoxes]);

  useEffect(() => {
    model.traverse((child: any) => {
      if (!child.isMesh || !child.material) return;

      const materials = Array.isArray(child.material)
        ? child.material.map((mat: any) => mat.clone())
        : [child.material.clone()];
      child.material = Array.isArray(child.material) ? materials : materials[0];

      materials.forEach((mat: any) => {
        if (mat.color) mat.color.set("#f0f1ef");
        if (mat.roughness !== undefined) mat.roughness = 0.94;
        if (mat.metalness !== undefined) mat.metalness = 0;
        mat.transparent = !lockedView;
        mat.opacity = lockedView ? 1 : 0.74;
        mat.side = lockedView ? THREE.FrontSide : THREE.DoubleSide;
        mat.depthTest = true;
        mat.depthWrite = true;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = 1;
        mat.polygonOffsetUnits = 1;
        // 脚模把轮廓写进模板缓冲，供热力图裁剪（只在脚模范围内显示）
        if (lockedView) {
          mat.stencilWrite = true;
          mat.stencilRef = 1;
          mat.stencilFunc = THREE.AlwaysStencilFunc;
          mat.stencilZPass = THREE.ReplaceStencilOp;
        }
        mat.needsUpdate = true;
      });

      if (child.getObjectByName("aciki-foot-wireframe")) return;

      const wireframe = new THREE.Mesh(
        child.geometry,
        new THREE.MeshBasicMaterial({
          color: "#d3d4d0",
          wireframe: true,
          transparent: true,
          opacity: lockedView ? 0.16 : 0.36,
          depthTest: true,
          depthWrite: false,
          side: lockedView ? THREE.FrontSide : THREE.DoubleSide,
        }),
      );
      wireframe.name = "aciki-foot-wireframe";
      wireframe.renderOrder = 2;
      wireframe.scale.setScalar(1);
      child.add(wireframe);
    });
  }, [model]);

  // lockedView 下 group 由 ref + useFrame 驱动：pose 切换（俯视↔站姿）时平滑旋转/缩放过渡。
  // 旋转绕"脚的几何中心"进行：每帧按 position = W0 - R(θ)·S·c 反解平移，
  // 使几何中心的世界位置恒定（= 俯视姿态下的位置），转动时脚不跑位。
  const groupRef = useRef<THREE.Group>(null);
  const settledRef = useRef(false);
  // 热力图淡入过渡：纹理"首次出现"（null→有）时从 0 渐显到 1；
  // 采集页每帧都在换纹理，用 hadHeatRef 只在首次触发，避免每帧重置导致闪烁。
  const heatFadeRef = useRef(0);
  const hadHeatRef = useRef(false);
  const heatMatsRef = useRef<Array<THREE.Material & { opacity: number }>>([]);
  const center3 = useMemo(() => bbox.getCenter(new THREE.Vector3()), [bbox]);
  const targetRotX = pose === "standing" ? STANDING_ROT_X : LOCKED_VIEW_ROTATION[0];

  const applyPivotPosition = (g: THREE.Group, theta: number, s: number) => {
    const { x: cx, y: cy, z: cz } = center3;
    // W0：俯视（θ=-π/2）时几何中心的世界位置
    const w0y = s * cz - 0.05;
    const w0z = -s * cy;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    g.position.set(-s * cx, w0y - s * (cy * cos - cz * sin), w0z - s * (cy * sin + cz * cos));
  };

  useEffect(() => {
    settledRef.current = false;
  }, [pose, scale]);
  useEffect(() => {
    const has = !!(leftTex || rightTex);
    if (has && !hadHeatRef.current) heatFadeRef.current = 0; // 仅"首次出现"触发淡入（采集页连续更新不重置）
    hadHeatRef.current = has;
  }, [leftTex, rightTex]);
  useEffect(() => {
    // 首次挂载直接就位（避免进页面时也播动画）
    const g = groupRef.current;
    if (g && lockedView) {
      g.rotation.set(targetRotX, 0, 0);
      g.scale.setScalar(scale);
      applyPivotPosition(g, targetRotX, scale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useFrame(() => {
    if (!lockedView) return;
    const g = groupRef.current;
    if (!g) return;
    const k = POSE_TRANSITION_K; // 过渡速度（顶部常量，附时长对照表）
    g.rotation.x += (targetRotX - g.rotation.x) * k;
    const s = g.scale.x + (scale - g.scale.x) * k;
    g.scale.setScalar(s);
    applyPivotPosition(g, g.rotation.x, s);
    if (!settledRef.current && Math.abs(g.rotation.x - targetRotX) < 0.004 && Math.abs(s - scale) < 0.01) {
      settledRef.current = true;
      g.rotation.x = targetRotX;
      g.scale.setScalar(scale);
      applyPivotPosition(g, targetRotX, scale);
      onPoseSettled?.();
    }
    // 热力图淡入（0→1，约 0.3s）
    if ((leftTex || rightTex) && heatFadeRef.current < 1) {
      heatFadeRef.current = Math.min(1, heatFadeRef.current + 0.06);
      const op = heatFadeRef.current * HEATMAP.opacity;
      for (const m of heatMatsRef.current) if (m) m.opacity = op;
    }
  });

  const heatPlane = (
    o: { position: [number, number, number]; rotation: [number, number, number]; args: [number, number] },
    tex: THREE.CanvasTexture,
    key: string,
    idx: number,
  ) =>
    ce(
      "mesh",
      { key, position: o.position, rotation: o.rotation, renderOrder: 3 },
      ce("planeGeometry", { args: o.args }),
      ce("meshBasicMaterial", {
        ref: (m: (THREE.Material & { opacity: number }) | null) => {
          heatMatsRef.current[idx] = m as THREE.Material & { opacity: number };
        },
        map: tex,
        transparent: true,
        // 初值随当前淡入进度：采集页 fade 已=1 → 直接满不闪；COP 首次进入 fade=0 → 由 useFrame 渐显
        opacity: heatFadeRef.current * HEATMAP.opacity,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        // 只在脚模写过的模板区域绘制 → 超出脚模轮廓即被裁剪不显示
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: THREE.EqualStencilFunc,
        stencilFail: THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.KeepStencilOp,
      }),
    );

  return ce(
    "group",
    lockedView
      ? { ref: groupRef } // 变换全部由 useFrame 驱动（pose 过渡动画）
      : {
          scale: [scale, scale, scale],
          position: [0, -0.3, 0],
          rotation: [Math.PI * 0.58, 0, 0],
        },
    ce("primitive", { object: model }),
    // 该 group 复制模型自身的局部变换 → 与模型几何同坐标系，热力图焊死不滑动、随缩放一起变
    lockedView
      ? ce(
          "group",
          {
            position: [model.position.x, model.position.y, model.position.z],
            quaternion: [
              model.quaternion.x,
              model.quaternion.y,
              model.quaternion.z,
              model.quaternion.w,
            ],
            scale: [model.scale.x, model.scale.y, model.scale.z],
          },
          leftTex ? heatPlane(overlays.left, leftTex, "hL", 0) : null,
          rightTex ? heatPlane(overlays.right, rightTex, "hR", 1) : null,
        )
      : null,
  );
}

function SceneContents({
  modelScale,
  autoRotate,
  lockedView,
  pressureData,
  heatVmax,
  fixedCamera,
  onFootRects,
  pose,
  onPoseSettled,
  zoneSections,
}: {
  modelScale: number;
  autoRotate: boolean;
  lockedView: boolean;
  pressureData?: number[][] | null;
  heatVmax?: number;
  fixedCamera?: boolean;
  onFootRects?: (rects: { left: FootAnno; right: FootAnno }) => void;
  pose?: "top" | "standing";
  onPoseSettled?: () => void;
  zoneSections?: { left: ZoneSections; right: ZoneSections } | null;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (lockedView) {
      camera.position.set(0, 0, 6.6);
      camera.lookAt(0, 0, 0);
      return;
    }

    camera.position.set(0, 3.5, 4.0);
    camera.lookAt(0, 0, 0);
  }, [camera, lockedView]);

  return ce(
    React.Fragment,
    null,
    ce("ambientLight", { intensity: 1.95 }),
    ce("directionalLight", {
      position: [0, 5, 3],
      intensity: 1.15,
      castShadow: false,
    }),
    ce("directionalLight", {
      position: [-3, 2, 2],
      intensity: 0.65,
    }),
    ce("directionalLight", {
      position: [0, -2, -3],
      intensity: 0.42,
    }),
    ce(
      Suspense,
      { fallback: null },
      ce(FeetMesh, { scale: modelScale, lockedView, pressureData, heatVmax, onFootRects, pose, onPoseSettled, zoneSections }),
      !lockedView &&
        !fixedCamera &&
        ce(OrbitControls, {
          enablePan: false,
          enableZoom: true,
          autoRotate,
          autoRotateSpeed: 0.8,
          minPolarAngle: 0,
          maxPolarAngle: Math.PI,
        }),
    ),
  );
}

interface FeetModel3DProps {
  width?: string | number;
  height?: string | number;
  modelScale?: number;
  autoRotate?: boolean;
  lockedView?: boolean;
  style?: React.CSSProperties;
  /** 实时压力帧（64×64），传入后在 lockedView 下叠加热力图 */
  pressureData?: number[][] | null;
  /** 热力图颜色映射上限（colorbar 上限，越小低压越鲜艳） */
  heatVmax?: number;
  /** 固定视角：非 lockedView 下也禁用拖动/旋转（报告页固定视图用） */
  fixedCamera?: boolean;
  /** lockedView 下回调每只脚的屏幕投影矩形（容器百分比），供外层贴合标注 */
  onFootRects?: (rects: { left: FootAnno; right: FootAnno }) => void;
  /** lockedView 姿态：top=俯视足底（默认），standing=站姿（足弓分析视角），切换带旋转过渡 */
  pose?: "top" | "standing";
  /** pose 过渡动画完成回调（用于延后展开标注） */
  onPoseSettled?: () => void;
  /** 足弓分区色块（压力/面积分析视图）：传入后替代热力图贴到脚模上 */
  zoneSections?: { left: ZoneSections; right: ZoneSections } | null;
}

export default function FeetModel3D({
  width = "100%",
  height = "100%",
  modelScale = 1.0,
  autoRotate = false,
  lockedView = false,
  style,
  pressureData = null,
  heatVmax,
  fixedCamera = false,
  onFootRects,
  pose = "top",
  onPoseSettled,
  zoneSections = null,
}: FeetModel3DProps) {
  return (
    <div style={{ position: "relative", width, height, ...style }}>
      <Canvas
        camera={{ position: lockedView ? [0, 0, 6.6] : [0, 3.5, 4.0], fov: lockedView ? 32 : 45 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true, stencil: true }}
      >
        <SceneContents
          modelScale={modelScale}
          autoRotate={autoRotate}
          lockedView={lockedView}
          pressureData={pressureData}
          heatVmax={heatVmax}
          fixedCamera={fixedCamera}
          onFootRects={onFootRects}
          pose={pose}
          onPoseSettled={onPoseSettled}
          zoneSections={zoneSections}
        />
      </Canvas>
    </div>
  );
}
