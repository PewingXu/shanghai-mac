/**
 * STL标准鞋垫3D预览组件 v3
 * 
 * 设计风格：工业级3D预览，简洁高效
 * 
 * 新增：实时分区加厚变形预览
 * - 根据前掌/中足/后跟的加厚参数，实时对模型顶面施加向上凸起变形
 * - 底面保持不变，顶面（脚面方向）隆起
 * - 使用smoothstep在区域边界做平滑过渡
 * - 加厚区域用渐变色高亮显示
 * 
 * 基准模型参数（42码，单位mm）：
 * - 足长: 261mm, 足宽: 95mm, 高度: 29.31mm
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, ContactShadows, Line } from '@react-three/drei';
import { Suspense, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

// 本地模型路径
const STL_PATHS = {
  left: '/models/42-1_L.stl',
  right: '/models/42-1_R.stl',
};

// 基准模型参数（42码，单位mm）
const BASE_MODEL = {
  footLength: 261,
  footWidth: 95,
  height: 29.31,
};

// 几何体缓存
const geoCache: Record<string, THREE.BufferGeometry> = {};

async function loadStlGeometry(
  foot: 'left' | 'right',
  onProgress?: (pct: number) => void
): Promise<THREE.BufferGeometry> {
  if (geoCache[foot]) {
    onProgress?.(100);
    return geoCache[foot];
  }

  const url = STL_PATHS[foot];

  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 30000;

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 90));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.ontimeout = () => reject(new Error('加载超时（30秒）'));
    xhr.send();
  });

  onProgress?.(95);

  const loader = new STLLoader();
  const geometry = loader.parse(buffer);

  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = box.min.z;
  geometry.translate(-cx, -cy, -cz);

  onProgress?.(100);
  geoCache[foot] = geometry;
  return geometry;
}

// ============ 分区加厚数据 ============

export interface RegionBoostPreview {
  forefoot: number;  // mm
  midfoot: number;   // mm
  hindfoot: number;  // mm
}

// 各区滑块量程（mm，与 SolutionPage 的 min/max 对应，±1.5mm）——
// 用于把"补偿厚度"按各区满量程归一化成颜色强度：
// 每个滑块从 0 拉到 ±1.5 即扫过 无色→满色，厚度变化直接对应清晰的颜色深浅。
const BOOST_RANGE = { forefoot: 1.5, midfoot: 1.5, hindfoot: 1.5 };


/**
 * sin² 钟形区权重（= 0520 latticeGeometry 的 createSmoothZoneWeight）：
 * 区间中心为 1，向两端在 [start,end] 内平滑衰减到 0，区间外为 0。
 */
function sinBellZone(v: number, start: number, end: number): number {
  if (v <= start || v >= end) return 0;
  const t = (v - start) / (end - start);
  return Math.sin(t * Math.PI) ** 2;
}

// 若足弓支撑出现在外侧(错侧)，把此值改为 false 即可翻转内外侧。
const MEDIAL_ON_POSITIVE_X = true;

/**
 * 局部分区权重（移植自 0520 getCompensationZoneWeights）——局部塑形而非整段平台：
 *  - 沿足长 sin² 钟形（区中心高、向两端渐弱），各区范围：后跟0.02–0.32 / 足弓0.28–0.56 / 前掌0.58–0.92
 *  - 沿足宽因子：前掌/后跟中心强 (0.75+0.25·(1−|x|)) / (0.8+0.2·(1−|x|))；足弓偏内侧 (0.4+0.6·max(0,内侧))
 * yNorm: 0=后跟 1=前掌；xNorm: 0..1 足宽。
 * ★ 需与 stlInsoleExporter.ts 的同名逻辑保持一致，否则预览≠导出。
 */
function localZoneWeights(
  yNorm: number,
  xNorm: number,
  foot: 'left' | 'right',
): { fore: number; arch: number; heel: number } {
  const nX = Math.max(-1, Math.min(1, (xNorm - 0.5) * 2));
  const sideX = MEDIAL_ON_POSITIVE_X ? nX : -nX;
  const innerSide = foot === 'left' ? sideX : -sideX;
  return {
    fore: sinBellZone(yNorm, 0.58, 0.92) * (0.75 + 0.25 * (1 - Math.abs(nX))),
    arch: sinBellZone(yNorm, 0.28, 0.56) * (0.4 + 0.6 * Math.max(0, innerSide)),
    heel: sinBellZone(yNorm, 0.02, 0.32) * (0.8 + 0.2 * (1 - Math.abs(nX))),
  };
}

/**
 * 对几何体应用分区加厚变形（顶面向上凸起）
 *
 * 同时生成颜色属性，用于高亮显示加厚区域
 */
function applyRegionBoostToGeometry(
  sourceGeometry: THREE.BufferGeometry,
  regionBoost: RegionBoostPreview,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  baseColor: THREE.Color,
  foot: 'left' | 'right',
): THREE.BufferGeometry {
  // 克隆几何体
  const geometry = sourceGeometry.clone();

  // 先应用缩放
  geometry.scale(scaleX, scaleY, scaleZ);

  const hasBoost = regionBoost.forefoot !== 0 || regionBoost.midfoot !== 0 || regionBoost.hindfoot !== 0;

  if (!hasBoost) {
    // 无加厚，添加统一颜色
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  const positions = geometry.attributes.position;
  const count = positions.count;
  const normals = geometry.attributes.normal; // 用于着色的"顶面朝上"判定

  // 计算边界
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const xMin = box.min.x;
  const xMax = box.max.x;
  const xRange = xMax - xMin;
  const yMin = box.min.y;
  const yMax = box.max.y;
  const yRange = yMax - yMin;
  const zMin = box.min.z;
  const zMax = box.max.z;
  const zRange = zMax - zMin;

  if (yRange <= 0 || zRange <= 0) return geometry;

  // 分区热力色（与 2D 脚模 zoneTint 同款：暖=增强支撑 橙→红，冷=减压/让位 浅蓝→深蓝）
  // 低饱和柔和配色（不刺眼，但从浅色底 lerp 过去仍有清晰深浅变化）
  const boostColor = new THREE.Color('#B85C43'); // 沉稳砖红：高支撑
  const midBoostColor = new THREE.Color('#D49A63'); // 柔和赭黄：中支撑
  const reliefColor = new THREE.Color('#3F6B96'); // 沉稳钢蓝：强减压
  const midReliefColor = new THREE.Color('#93B2C9'); // 柔和青灰蓝：中减压
  const tempColor = new THREE.Color();
  const tintColor = new THREE.Color();

  const zBottom = zMin;

  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    // 归一化Y坐标 (0=后跟, 1=前掌)
    const yNorm = (y - yMin) / yRange;
    // 归一化X坐标 (0..1，足宽方向)
    const xNorm = xRange > 0 ? (x - xMin) / xRange : 0.5;

    // Z归一化（底部=0，顶部=1）
    const zNorm = (z - zMin) / zRange;

    // 顶部权重：越靠近顶面（脚面），加厚越多
    const topWeight = Math.max(0, zNorm);

    // 局部分区权重（移植自 0520）：sin² 钟形 + 足宽因子（前掌/后跟中心强、足弓偏内侧）。
    // ★ 需与 stlInsoleExporter.ts 的 applyRegionBoost 保持一致，否则预览≠导出。
    const w = localZoneWeights(yNorm, xNorm, foot);

    const boostMm =
      w.heel * regionBoost.hindfoot +
      w.arch * regionBoost.midfoot +
      w.fore * regionBoost.forefoot;

    if (boostMm !== 0) {
      // 顶面偏移：正=向上鼓(增强支撑)，负=向下凹(减压/让位)；底面不动，夹住不穿底。
      const zOffset = boostMm * topWeight;
      positions.setZ(i, Math.max(zBottom, z + zOffset));
    }

    // 颜色强度 = 该点真实局部补偿厚度归一化（各区上限 ±1.5mm）。
    // 权重是 sin² 钟形 + 足宽因子，故颜色天然"中心深、向四周渐淡、足弓偏内"，与几何一致。
    const level =
      w.heel * (regionBoost.hindfoot / BOOST_RANGE.hindfoot) +
      w.arch * (regionBoost.midfoot / BOOST_RANGE.midfoot) +
      w.fore * (regionBoost.forefoot / BOOST_RANGE.forefoot);
    const signedT = level;
    const t = Math.min(1, Math.abs(signedT));  // 0..1：局部厚度占该区满量程的比例
    if (t > 0.02) {
      // 色相随厚度加深：小幅=橙/浅蓝，大幅=红/深蓝
      if (signedT >= 0) tintColor.copy(midBoostColor).lerp(boostColor, t); // 橙→红
      else tintColor.copy(midReliefColor).lerp(reliefColor, t);           // 浅蓝→深蓝
      // 顶面聚焦：用法向朝上(normal.z)判定，与全局高度无关——
      // 前掌等较薄区域的顶面也能满色（不再因绝对高度低而被压暗）。
      const nz = normals ? normals.getZ(i) : 1;
      const topFocus = Math.max(0, nz);
      // 浓度随厚度(t)提升；floor 0.30 让轻补偿也看得清，侧壁/底面淡出到本色
      const mix = Math.min(1, (0.30 + 0.70 * t) * (0.25 + 0.75 * topFocus));
      tempColor.copy(baseColor).lerp(tintColor, mix);
    } else {
      tempColor.copy(baseColor);
    }

    colors[i * 3] = tempColor.r;
    colors[i * 3 + 1] = tempColor.g;
    colors[i * 3 + 2] = tempColor.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  return geometry;
}

// ============ 单只鞋垫STL模型 ============

function SingleStlInsole({
  geometry,
  footLength,
  footWidth,
  heightScale,
  color,
  positionX,
  regionBoost,
  foot,
}: {
  geometry: THREE.BufferGeometry;
  footLength: number;
  footWidth: number;
  heightScale: number;
  color: string;
  positionX: number;
  regionBoost?: RegionBoostPreview;
  foot: 'left' | 'right';
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  const scales = useMemo(() => {
    const targetLengthMm = footLength * 10;
    const targetWidthMm = footWidth * 10;
    return {
      x: targetWidthMm / BASE_MODEL.footWidth,
      y: targetLengthMm / BASE_MODEL.footLength,
      z: heightScale,
    };
  }, [footLength, footWidth, heightScale]);

  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  const hasBoost = !!regionBoost && (regionBoost.forefoot !== 0 || regionBoost.midfoot !== 0 || regionBoost.hindfoot !== 0);

  // 计算带分区加厚的几何体
  const boostedGeometry = useMemo(() => {
    const boost = regionBoost || { forefoot: 0, midfoot: 0, hindfoot: 0 };
    return applyRegionBoostToGeometry(
      geometry,
      boost,
      scales.x,
      scales.y,
      scales.z,
      baseColor,
      foot,
    );
  }, [geometry, regionBoost, scales.x, scales.y, scales.z, baseColor, foot]);

  // 原始（未补偿）鞋垫的半透明参照层：仅在有补偿时构建。
  // 与补偿后的实体叠加——凹陷区能透出原始的更高表面（"减掉了多少"），
  // 隆起区则见实体穿出原始表面（"抬升了多少"），直观表达调节量。
  const ghostGeometry = useMemo(() => {
    if (!hasBoost) return null;
    const g = geometry.clone();
    g.scale(scales.x, scales.y, scales.z);
    g.computeVertexNormals();
    return g;
  }, [geometry, hasBoost, scales.x, scales.y, scales.z]);

  // 材质：支持顶点颜色。
  //  - 无补偿：普通哑光材质。
  //  - 有补偿：物理材质 + 清漆层(clearcoat)，呈现晶格鞋垫的通透胶感；
  //    并叠一层"按顶点色彩度"的柔和自发光——灰底(无补偿)不发光，
  //    仅补偿区微微透亮（配色已是低饱和，通透但不刺眼）。纯渲染，不改几何/数值。
  const material = useMemo(() => {
    if (!hasBoost) {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.0,
        envMapIntensity: 0.18,
      });
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.35,
      envMapIntensity: 0.25,
    });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR
          float _cMax = max(max(vColor.r, vColor.g), vColor.b);
          float _cMin = min(min(vColor.r, vColor.g), vColor.b);
          float _chroma = _cMax - _cMin;            // 灰底≈0，补偿区>0
          totalEmissiveRadiance += vColor.rgb * _chroma * 0.42;
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'insole-comp-glow-v1';
    return mat;
  }, [hasBoost, color]);

  // 参照层材质：中性浅灰、半透明、不写深度（避免与实体 z-fighting）
  const ghostMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: 0xbfc4cb,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }), []);

  // 清理
  useEffect(() => {
    return () => {
      boostedGeometry.dispose();
      material.dispose();
      ghostGeometry?.dispose();
      ghostMaterial.dispose();
    };
  }, [boostedGeometry, material, ghostGeometry, ghostMaterial]);

  const sceneScale = 0.01;

  // 几何尺寸（mm，居中：x∈[-W/2,W/2] 足宽、y∈[-L/2,L/2] 足长、z∈[0,H] 高）
  const L = footLength * 10;
  const W = footWidth * 10;
  const H = BASE_MODEL.height * heightScale;
  // 内侧方向（+1=+x / -1=-x），与 localZoneWeights 的足弓偏内侧一致
  const medialSign = (foot === 'left' ? 1 : -1) * (MEDIAL_ON_POSITIVE_X ? 1 : -1);

  // 各区"热点圈"：形状/大小按区各异、并随补偿量放大（前掌横宽=跖骨垫、足弓偏内侧窄长倾斜、后跟较圆）；
  // 并**贴合鞋垫顶面**（对圈上每点向下投射取实际表面高度，+0.6mm 微浮防遮挡）。仅圈有补偿的区。
  const drapedOutlines = useMemo(() => {
    if (!hasBoost) return [] as { key: string; points: [number, number, number][]; val: number }[];
    const mag = (v: number) => Math.min(1, Math.abs(v) / 1.5); // 0..1：补偿占满量程比例
    const specs = [
      { key: 'fore', val: regionBoost?.forefoot ?? 0, cx: 0, cy: L * 0.25, rot: 0,
        rx: (m: number) => W * (0.095 + 0.04 * m), ry: (m: number) => L * (0.038 + 0.016 * m) },
      { key: 'arch', val: regionBoost?.midfoot ?? 0, cx: medialSign * W * 0.36, cy: -L * 0.08, rot: medialSign * 0.35,
        rx: (m: number) => W * (0.037 + 0.015 * m), ry: (m: number) => L * (0.04 + 0.015 * m) },
      { key: 'heel', val: regionBoost?.hindfoot ?? 0, cx: 0, cy: -L * 0.33, rot: 0,
        rx: (m: number) => W * (0.07 + 0.028 * m), ry: (m: number) => L * (0.033 + 0.013 * m) },
    ].filter((s) => Math.abs(s.val) > 0.01);
    if (specs.length === 0) return [];
    const tmp = new THREE.Mesh(boostedGeometry);
    tmp.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(0, 0, -1);
    const org = new THREE.Vector3();
    const n = 44;
    return specs.map((s) => {
      const m = mag(s.val);
      const rx = s.rx(m), ry = s.ry(m);
      const cosP = Math.cos(s.rot), sinP = Math.sin(s.rot);
      const points: [number, number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
        const x = s.cx + ex * cosP - ey * sinP;
        const y = s.cy + ex * sinP + ey * cosP;
        org.set(x, y, H + 30);
        ray.set(org, dir);
        const hit = ray.intersectObject(tmp, false)[0];
        points.push([x, y, (hit ? hit.point.z : H) + 0.6]);
      }
      return { key: s.key, points, val: s.val };
    });
  }, [boostedGeometry, hasBoost, L, W, H, medialSign, regionBoost?.forefoot, regionBoost?.midfoot, regionBoost?.hindfoot]);

  return (
    <group position={[positionX, 0, 0]}>
      <mesh
        ref={meshRef}
        geometry={boostedGeometry}
        material={material}
        scale={[sceneScale, sceneScale, sceneScale]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={0}
        castShadow
        receiveShadow
      />
      {/* 原始鞋垫参照层（半透明，叠在补偿实体之上作对比） */}
      {ghostGeometry && (
        <mesh
          geometry={ghostGeometry}
          material={ghostMaterial}
          scale={[sceneScale, sceneScale, sceneScale]}
          rotation={[-Math.PI / 2, 0, 0]}
          renderOrder={1}
        />
      )}
      {/* 热点峰值虚线圈：贴合顶面、只圈很小的峰值块（随鞋垫同变换） */}
      <group rotation={[-Math.PI / 2, 0, 0]} scale={[sceneScale, sceneScale, sceneScale]}>
        {drapedOutlines.map((o) => (
          <Line
            key={o.key}
            points={o.points}
            /* 同色系的更深色：正=暖(支撑) 负=冷(减压)，比热点更深→看得清又不突兀 */
            color={o.val >= 0 ? '#8A4A28' : '#2F5578'}
            lineWidth={1.5}
            dashed
            dashSize={2.6}
            gapSize={1.8}
            transparent
            opacity={0.82}
          />
        ))}
      </group>
    </group>
  );
}

// ============ 3D场景 ============

function InsoleScene({
  activeFoot,
  autoRotate,
  color,
  leftParams,
  rightParams,
  leftGeo,
  rightGeo,
}: {
  activeFoot: 'left' | 'right' | 'both';
  autoRotate: boolean;
  color: string;
  leftParams: StlInsoleParams;
  rightParams: StlInsoleParams;
  leftGeo: THREE.BufferGeometry | null;
  rightGeo: THREE.BufferGeometry | null;
}) {
  const spacing = 1.6;

  const calcHeightScale = (params: StlInsoleParams) => {
    const totalHeightMm = params.baseThickness * 10 + params.archCorrection + params.heelThickness;
    return totalHeightMm / BASE_MODEL.height;
  };

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 3.0, 3.5]} fov={35} />
      <OrbitControls
        enablePan enableZoom enableRotate
        autoRotate={autoRotate}
        autoRotateSpeed={1.5}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={2}
        maxDistance={10}
      />

      {/* 纯本地灯光（不依赖外网 HDR 环境贴图，避免离线/受限网络下加载失败） */}
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
        {/* 左脚 */}
        {(activeFoot === 'left' || activeFoot === 'both') && leftGeo && (
          <SingleStlInsole
            geometry={leftGeo}
            footLength={leftParams.footLength}
            footWidth={leftParams.footWidth}
            heightScale={calcHeightScale(leftParams)}
            color={color}
            positionX={activeFoot === 'both' ? -spacing / 2 : 0}
            regionBoost={leftParams.regionBoost}
            foot="left"
          />
        )}

        {/* 右脚 */}
        {(activeFoot === 'right' || activeFoot === 'both') && rightGeo && (
          <SingleStlInsole
            geometry={rightGeo}
            footLength={rightParams.footLength}
            footWidth={rightParams.footWidth}
            heightScale={calcHeightScale(rightParams)}
            color={color}
            positionX={activeFoot === 'both' ? spacing / 2 : 0}
            regionBoost={rightParams.regionBoost}
            foot="right"
          />
        )}

        <ContactShadows
          position={[0, -0.01, 0]}
          opacity={0.3}
          scale={8}
          blur={2}
          far={3}
        />
      </Suspense>

      {/* 地面网格 */}
      <gridHelper args={[6, 20, '#cbd5e1', '#e2e8f0']} position={[0, -0.02, 0]} />
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
  regionBoost?: RegionBoostPreview;
}

interface StlInsoleViewerProps {
  activeFoot: 'left' | 'right' | 'both';
  autoRotate?: boolean;
  color?: string;
  leftParams: StlInsoleParams;
  rightParams: StlInsoleParams;
  onLoadError?: (error: string) => void;
}

// ============ 主组件 ============

export function StlInsoleViewer({
  activeFoot,
  autoRotate = false,
  color = '#B0B0B0',
  leftParams,
  rightParams,
  onLoadError,
}: StlInsoleViewerProps) {
  const [leftGeo, setLeftGeo] = useState<THREE.BufferGeometry | null>(null);
  const [rightGeo, setRightGeo] = useState<THREE.BufferGeometry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setProgress(0);

      const left = await loadStlGeometry('left', (pct) => setProgress(Math.round(pct * 0.5)));
      const right = await loadStlGeometry('right', (pct) => setProgress(50 + Math.round(pct * 0.5)));

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
  }, [onLoadError]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleRetry = useCallback(() => {
    delete geoCache['left'];
    delete geoCache['right'];
    setRetryCount(c => c + 1);
    loadModels();
  }, [loadModels]);

  if (loading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-lg">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">正在加载鞋垫模型...</div>
        <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
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
        <button
          className="flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
          onClick={handleRetry}
        >
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
          leftParams={leftParams}
          rightParams={rightParams}
          leftGeo={leftGeo}
          rightGeo={rightGeo}
        />
      </Canvas>

      <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
        ◆ 左键: 旋转 · 右键: 平移 · 滚轮: 缩放
      </div>
    </div>
  );
}

export default StlInsoleViewer;
