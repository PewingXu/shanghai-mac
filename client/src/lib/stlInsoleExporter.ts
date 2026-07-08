/**
 * STL标准鞋垫导出工具 v2
 * 
 * 加载简化后的标准晶格体STL模型（60k面，~2.9MB），
 * 应用参数化缩放和分区加厚后导出为STL/GLB格式。
 * 
 * 分区加厚原理：
 * 根据顶点在Y轴（足长方向）的归一化位置判断所属区域：
 * - 前掌区 (forefoot): Y归一化 > 0.55 (脚趾端)
 * - 中足区 (midfoot): Y归一化 0.25 ~ 0.55
 * - 后跟区 (hindfoot): Y归一化 < 0.25 (脚跟端)
 * 区域边界使用平滑过渡（smoothstep），避免突变。
 * 
 * 基准模型参数（42码，单位mm）：
 * - 足长: 261mm, 足宽: 95mm, 高度: 29.31mm
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const STL_PATHS = {
  left: '/models/42-1_L.stl',
  right: '/models/42-1_R.stl',
};

const BASE_MODEL = {
  footLength: 261,
  footWidth: 95,
  height: 29.31,
};

export interface RegionBoostData {
  forefoot: number;  // mm
  midfoot: number;   // mm
  hindfoot: number;  // mm
}

const geometryCache: Record<string, THREE.BufferGeometry> = {};

async function loadStlGeometry(foot: 'left' | 'right'): Promise<THREE.BufferGeometry> {
  if (geometryCache[foot]) {
    return geometryCache[foot].clone();
  }

  const url = STL_PATHS[foot];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`加载模型失败: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  
  const loader = new STLLoader();
  const geometry = loader.parse(arrayBuffer);

  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = box.min.z;
  geometry.translate(-cx, -cy, -cz);

  geometryCache[foot] = geometry;
  return geometry.clone();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** sin² 钟形区权重（= 0520 latticeGeometry 的 createSmoothZoneWeight） */
function sinBellZone(v: number, start: number, end: number): number {
  if (v <= start || v >= end) return 0;
  const t = (v - start) / (end - start);
  return Math.sin(t * Math.PI) ** 2;
}

// 若足弓支撑出现在外侧(错侧)，改为 false 翻转；★ 需与 StlInsoleViewer.tsx 保持一致。
const MEDIAL_ON_POSITIVE_X = true;

/**
 * 局部分区权重（移植自 0520 getCompensationZoneWeights）：
 * 沿足长 sin² 钟形 × 足宽因子（前掌/后跟中心强，足弓偏内侧）。
 * yNorm: 0=后跟 1=前掌；xNorm: 0..1 足宽。
 * ★ 需与 StlInsoleViewer.tsx 的 localZoneWeights 完全一致，否则预览≠导出。
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
 * 对几何体应用分区加厚
 * 
 * 根据顶点Y坐标（足长方向）判断所属区域，
 * 对Z轴（高度方向）施加差异化偏移。
 * 
 * 加厚方向：向上（脚面方向）扩展，即顶面向上凸起，
 * 底面保持不变，这样高压区域能更好地承托和分散压力。
 * 
 * 使用smoothstep在区域边界做平滑过渡，避免几何体突变。
 */
function applyRegionBoost(
  geometry: THREE.BufferGeometry,
  regionBoost: RegionBoostData,
  totalHeightMm: number,
  foot: 'left' | 'right',
): void {
  if (regionBoost.forefoot === 0 && regionBoost.midfoot === 0 && regionBoost.hindfoot === 0) {
    return; // 无加厚，跳过
  }

  const positions = geometry.attributes.position;
  const count = positions.count;

  // 计算 X(足宽) / Y(足长) / Z(高度) 范围
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const xMin = box.min.x;
  const xRange = box.max.x - xMin;
  const yMin = box.min.y;
  const yRange = box.max.y - yMin;
  const zMin = box.min.z;
  const zRange = box.max.z - zMin;

  if (yRange <= 0 || zRange <= 0) return;

  for (let i = 0; i < count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    // 归一化：yNorm 0=后跟 1=前掌；xNorm 0..1 足宽；zNorm 0=底 1=顶
    const yNorm = (y - yMin) / yRange;
    const xNorm = xRange > 0 ? (x - xMin) / xRange : 0.5;
    const zNorm = (z - zMin) / zRange;
    const topWeight = Math.max(0, zNorm); // 只抬顶面，底面不动

    // 局部分区权重（sin² 钟形 + 足宽因子；足弓偏内侧）——局部塑形而非整段平台。
    // ★ 需与 StlInsoleViewer.tsx 的 localZoneWeights 完全一致，否则预览≠导出。
    const w = localZoneWeights(yNorm, xNorm, foot);

    const boostMm =
      w.heel * regionBoost.hindfoot +
      w.arch * regionBoost.midfoot +
      w.fore * regionBoost.forefoot;

    if (boostMm !== 0) {
      const zOffset = boostMm * topWeight;
      positions.setZ(i, Math.max(zMin, z + zOffset)); // 夹住不穿底
    }
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
}

export async function exportStlInsoleSTL(
  foot: 'left' | 'right',
  footLength: number,
  footWidth: number,
  archCorrection: number,
  baseThickness: number,
  heelThickness: number,
  color: string = '#B0B0B0',
  userName?: string,
  regionBoost?: RegionBoostData
): Promise<void> {
  const geometry = await loadStlGeometry(foot);

  const targetLengthMm = footLength * 10;
  const targetWidthMm = footWidth * 10;
  const totalHeightMm = baseThickness * 10 + archCorrection + heelThickness;

  const scaleX = targetWidthMm / BASE_MODEL.footWidth;
  const scaleY = targetLengthMm / BASE_MODEL.footLength;
  const scaleZ = totalHeightMm / BASE_MODEL.height;

  geometry.scale(scaleX, scaleY, scaleZ);

  // 应用分区加厚
  if (regionBoost) {
    applyRegionBoost(geometry, regionBoost, totalHeightMm, foot);
  }

  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `insole_${foot}`;

  const exporter = new STLExporter();
  const stlData = exporter.parse(mesh, { binary: true });

  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const footLabel = foot === 'left' ? '左脚' : '右脚';
  const prefix = userName ? `${userName}_` : '';
  
  // 文件名包含加厚信息
  let boostSuffix = '';
  if (regionBoost && (regionBoost.forefoot > 0 || regionBoost.midfoot > 0 || regionBoost.hindfoot > 0)) {
    boostSuffix = `_加厚F${regionBoost.forefoot}M${regionBoost.midfoot}H${regionBoost.hindfoot}`;
  }
  
  const filename = `${prefix}${footLabel}_鞋垫_${targetLengthMm.toFixed(0)}mm_矫正${archCorrection}mm${boostSuffix}.stl`;

  downloadBlob(blob, filename);
  geometry.dispose();
  material.dispose();
}

export async function exportStlInsoleGLTF(
  foot: 'left' | 'right',
  footLength: number,
  footWidth: number,
  archCorrection: number,
  baseThickness: number,
  heelThickness: number,
  color: string = '#B0B0B0',
  userName?: string,
  regionBoost?: RegionBoostData
): Promise<void> {
  const geometry = await loadStlGeometry(foot);

  const targetLengthMm = footLength * 10;
  const targetWidthMm = footWidth * 10;
  const totalHeightMm = baseThickness * 10 + archCorrection + heelThickness;

  const scaleX = targetWidthMm / BASE_MODEL.footWidth;
  const scaleY = targetLengthMm / BASE_MODEL.footLength;
  const scaleZ = totalHeightMm / BASE_MODEL.height;

  geometry.scale(scaleX, scaleY, scaleZ);

  // 应用分区加厚
  if (regionBoost) {
    applyRegionBoost(geometry, regionBoost, totalHeightMm, foot);
  }

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.35,
    metalness: 0.15,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `insole_${foot}`;

  const scene = new THREE.Scene();
  scene.add(mesh);

  const exporter = new GLTFExporter();

  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => {
        let blob: Blob;
        if (result instanceof ArrayBuffer) {
          blob = new Blob([result], { type: 'application/octet-stream' });
        } else {
          const jsonStr = JSON.stringify(result, null, 2);
          blob = new Blob([jsonStr], { type: 'application/json' });
        }

        const footLabel = foot === 'left' ? '左脚' : '右脚';
        const prefix = userName ? `${userName}_` : '';
        const ext = result instanceof ArrayBuffer ? 'glb' : 'gltf';
        
        let boostSuffix = '';
        if (regionBoost && (regionBoost.forefoot > 0 || regionBoost.midfoot > 0 || regionBoost.hindfoot > 0)) {
          boostSuffix = `_加厚F${regionBoost.forefoot}M${regionBoost.midfoot}H${regionBoost.hindfoot}`;
        }
        
        const filename = `${prefix}${footLabel}_鞋垫_${(footLength * 10).toFixed(0)}mm_矫正${archCorrection}mm${boostSuffix}.${ext}`;

        downloadBlob(blob, filename);
        geometry.dispose();
        material.dispose();
        resolve();
      },
      (error) => {
        console.error('GLTF导出失败:', error);
        geometry.dispose();
        material.dispose();
        reject(error);
      },
      { binary: true }
    );
  });
}
