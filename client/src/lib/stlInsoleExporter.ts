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
import {
  STYLE_DEFS,
  centerGeometry,
  splitProductPair,
  computeScales,
  applyDeform,
  ZERO_DEFORM,
  type InsoleStyle,
  type BaseDims,
  type DeformMm,
} from './insoleModel';

interface CachedGeo {
  geometry: THREE.BufferGeometry;
  base: BaseDims;
}

const geometryCache: Record<string, CachedGeo> = {}; // key: `${style}:${foot}`

/** 加载并缓存（样式+脚）几何体，返回可安全修改的克隆 + 原生尺寸 */
async function loadStlGeometry(
  style: InsoleStyle,
  foot: 'left' | 'right',
): Promise<CachedGeo> {
  const key = `${style}:${foot}`;
  if (geometryCache[key]) {
    return { geometry: geometryCache[key].geometry.clone(), base: geometryCache[key].base };
  }

  const def = STYLE_DEFS[style];

  const fetchParse = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`加载模型失败: HTTP ${response.status}`);
    const geometry = new STLLoader().parse(await response.arrayBuffer());
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return geometry;
  };

  if (def.kind === 'split') {
    const geometry = await fetchParse(foot === 'left' ? def.left! : def.right!);
    const base = centerGeometry(geometry);
    geometryCache[key] = { geometry, base };
  } else {
    // 成品垫：整文件拆成左右一并入缓存
    const whole = await fetchParse(def.url!);
    const { left, right } = splitProductPair(whole);
    whole.dispose();
    geometryCache[`${style}:left`] = { geometry: left, base: centerGeometry(left) };
    geometryCache[`${style}:right`] = { geometry: right, base: centerGeometry(right) };
  }

  return { geometry: geometryCache[key].geometry.clone(), base: geometryCache[key].base };
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

export async function exportStlInsoleSTL(
  style: InsoleStyle,
  foot: 'left' | 'right',
  footLength: number,
  footWidth: number,
  archCorrection: number,
  baseThickness: number,
  heelThickness: number,
  color: string = '#B0B0B0',
  userName?: string,
  deform: DeformMm = ZERO_DEFORM,
): Promise<void> {
  const { geometry, base } = await loadStlGeometry(style, foot);

  const targetLengthMm = footLength * 10;
  const { x: scaleX, y: scaleY, z: scaleZ } = computeScales(base, style, {
    footLengthCm: footLength,
    footWidthCm: footWidth,
    baseThicknessCm: baseThickness,
    archCorrectionMm: archCorrection,
    heelThicknessMm: heelThickness,
  });

  geometry.scale(scaleX, scaleY, scaleZ);
  // 成品垫：把厚度增量烘成顶面隆起（与预览着色器同公式；足弓偏内侧故需左右脚）
  if (STYLE_DEFS[style].heightMode === 'proportional') applyDeform(geometry, deform, foot, style);

  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color) });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `insole_${foot}`;

  const exporter = new STLExporter();
  const stlData = exporter.parse(mesh, { binary: true });

  const blob = new Blob([stlData], { type: 'application/octet-stream' });
  const footLabel = foot === 'left' ? '左脚' : '右脚';
  const prefix = userName ? `${userName}_` : '';

  const filename = `${prefix}${footLabel}_${STYLE_DEFS[style].label}鞋垫_${targetLengthMm.toFixed(0)}mm_矫正${archCorrection}mm.stl`;

  downloadBlob(blob, filename);
  geometry.dispose();
  material.dispose();
}

export async function exportStlInsoleGLTF(
  style: InsoleStyle,
  foot: 'left' | 'right',
  footLength: number,
  footWidth: number,
  archCorrection: number,
  baseThickness: number,
  heelThickness: number,
  color: string = '#B0B0B0',
  userName?: string,
  deform: DeformMm = ZERO_DEFORM,
): Promise<void> {
  const { geometry, base } = await loadStlGeometry(style, foot);

  const { x: scaleX, y: scaleY, z: scaleZ } = computeScales(base, style, {
    footLengthCm: footLength,
    footWidthCm: footWidth,
    baseThicknessCm: baseThickness,
    archCorrectionMm: archCorrection,
    heelThicknessMm: heelThickness,
  });

  geometry.scale(scaleX, scaleY, scaleZ);
  if (STYLE_DEFS[style].heightMode === 'proportional') applyDeform(geometry, deform, foot, style);

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

        const filename = `${prefix}${footLabel}_${STYLE_DEFS[style].label}鞋垫_${(footLength * 10).toFixed(0)}mm_矫正${archCorrection}mm.${ext}`;

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
