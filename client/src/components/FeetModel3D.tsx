import React, { Suspense, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const ce = React.createElement;
const MODEL_URL = "/assets/models/feet-3d-model.glb";
const LOCKED_VIEW_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

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

function FeetMesh({
  scale,
  lockedView,
  pressureData,
  heatVmax,
}: {
  scale: number;
  lockedView: boolean;
  pressureData?: number[][] | null;
  heatVmax?: number;
}) {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => scene.clone(true), [scene]);
  // 模型包围盒（局部空间）：用于居中补偿 + 热力图平面定位
  const bbox = useMemo(() => new THREE.Box3().setFromObject(model), [model]);
  const centerX = useMemo(() => bbox.getCenter(new THREE.Vector3()).x, [bbox]);

  // 每只脚的局部包围盒（按 x 相对中心分左右），用于各自贴图定位
  const footBoxes = useMemo(() => {
    model.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const cx = bbox.getCenter(new THREE.Vector3()).x;
    const left = new THREE.Box3().makeEmpty();
    const right = new THREE.Box3().makeEmpty();
    const v = new THREE.Vector3();
    model.traverse((child: any) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
      const pos = child.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        (v.x < cx ? left : right).expandByPoint(v);
      }
    });
    return { left, right };
  }, [model, bbox]);

  // 左右脚各自的热力图纹理（各取一半列范围），并释放旧纹理
  const leftTex = useMemo(() => {
    if (!lockedView) return null;
    const [a, b] = HEATMAP.swapFeet ? [32, 64] : [0, 32];
    return buildHeatmapTexture(pressureData ?? null, a, b, heatVmax ?? HEATMAP.vmax);
  }, [pressureData, lockedView, heatVmax]);
  const rightTex = useMemo(() => {
    if (!lockedView) return null;
    const [a, b] = HEATMAP.swapFeet ? [0, 32] : [32, 64];
    return buildHeatmapTexture(pressureData ?? null, a, b, heatVmax ?? HEATMAP.vmax);
  }, [pressureData, lockedView, heatVmax]);
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
    return { left: build(footBoxes.left), right: build(footBoxes.right) };
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

  const heatPlane = (
    o: { position: [number, number, number]; rotation: [number, number, number]; args: [number, number] },
    tex: THREE.CanvasTexture,
    key: string,
  ) =>
    ce(
      "mesh",
      { key, position: o.position, rotation: o.rotation, renderOrder: 3 },
      ce("planeGeometry", { args: o.args }),
      ce("meshBasicMaterial", {
        map: tex,
        transparent: true,
        opacity: HEATMAP.opacity,
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
    {
      scale: [scale, scale, scale],
      position: lockedView ? [-scale * centerX, -0.05, 0] : [0, -0.3, 0],
      rotation: lockedView ? LOCKED_VIEW_ROTATION : [Math.PI * 0.58, 0, 0],
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
          leftTex ? heatPlane(overlays.left, leftTex, "hL") : null,
          rightTex ? heatPlane(overlays.right, rightTex, "hR") : null,
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
}: {
  modelScale: number;
  autoRotate: boolean;
  lockedView: boolean;
  pressureData?: number[][] | null;
  heatVmax?: number;
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
      ce(FeetMesh, { scale: modelScale, lockedView, pressureData, heatVmax }),
      !lockedView &&
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
        />
      </Canvas>
    </div>
  );
}
