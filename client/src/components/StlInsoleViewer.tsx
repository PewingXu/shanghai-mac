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

import { Canvas } from '@react-three/fiber';
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
  type InsoleStyle,
  type BaseDims,
  type DeformMm,
} from '@/lib/insoleModel';

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

  const sceneScale = 0.01;

  return (
    <group position={[positionX, 0, 0]}>
      <mesh
        geometry={preparedGeometry}
        material={material}
        scale={[sceneScale, sceneScale, sceneScale]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={0}
        castShadow
        receiveShadow
      />
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
      <div style={{ fontSize: '11px', color: '#5A4A30', fontWeight: 600, marginBottom: '6px' }}>
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
            color: '#8a8275',
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
}) {
  const spacing = 1.6;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 3.0, 3.5]} fov={35} />
      <OrbitControls
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
        {(activeFoot === 'left' || activeFoot === 'both') && leftGeo && (
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
          />
        )}

        {(activeFoot === 'right' || activeFoot === 'both') && rightGeo && (
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
          />
        )}

        <ContactShadows position={[0, -0.01, 0]} opacity={0.3} scale={8} blur={2} far={3} />
      </Suspense>

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
}: StlInsoleViewerProps) {
  const [leftGeo, setLeftGeo] = useState<LoadedGeo | null>(null);
  const [rightGeo, setRightGeo] = useState<LoadedGeo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  // 定制形变热力图：默认关，默认仍显示客户选的鞋垫颜色
  const [heatmap, setHeatmap] = useState(false);

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
        />
      </Canvas>

      <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
        ◆ 左键: 旋转 · 右键: 平移 · 滚轮: 缩放
      </div>

      <button
        type="button"
        onClick={() => setHeatmap((v) => !v)}
        aria-pressed={heatOn}
        className="absolute top-2 right-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
        style={{
          background: heatOn ? '#FF8400' : 'rgba(255,255,255,0.92)',
          color: heatOn ? '#fff' : '#5A4A30',
          border: '1px solid rgba(225,203,180,0.55)',
        }}
      >
        <Layers className="w-3.5 h-3.5" />
        定制对比
      </button>

      {heatOn && <HeatLegend />}
    </div>
  );
}

export default StlInsoleViewer;
