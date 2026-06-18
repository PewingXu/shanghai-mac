import React, { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

const ce = React.createElement;

// 使用压缩版 GLB（2.5 MB，原始 6.4 MB 压缩 61%）
const MODEL_URL = "/assets/models/feet-3d-model.glb";

// 预加载模型
useGLTF.preload(MODEL_URL);

function FeetMesh({ scale }: { scale: number }) {
  const { scene } = useGLTF(MODEL_URL);

  useEffect(() => {
    scene.traverse((child: any) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        mats.forEach((mat: any) => {
          // 不修改 color，保留原始纹理颜色（白色底+网格线）
          // 提高粗糙度，减少高光，让表面更柔和
          if (mat.roughness !== undefined) mat.roughness = 0.9;
          if (mat.metalness !== undefined) mat.metalness = 0.0;
          // 双面渲染，确保脚底可见
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        });
      }
    });
  }, [scene]);

  // 旋转模型：绕X轴旋转让脚底朝上（面向相机）
  return ce("primitive", {
    object: scene,
    scale: [scale, scale, scale],
    position: [0, -0.3, 0],
    rotation: [Math.PI * 0.55, 0, 0],
  });
}

function SceneContents({
  modelScale,
  autoRotate,
}: {
  modelScale: number;
  autoRotate: boolean;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 3.5, 4.0);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return ce(
    React.Fragment,
    null,
    // 环境光：适中亮度，不过曝，保留纹理细节
    ce("ambientLight", { intensity: 1.8 }),
    // 主光源：从正上方偏前打光
    ce("directionalLight", {
      position: [0, 5, 3],
      intensity: 1.2,
      castShadow: false,
    }),
    // 补光：从侧面补充，减少阴影
    ce("directionalLight", {
      position: [-3, 2, 2],
      intensity: 0.6,
    }),
    // 背光：从后方轻微补光，让脚底也能看清
    ce("directionalLight", {
      position: [0, -2, -3],
      intensity: 0.4,
    }),
    ce(
      Suspense,
      { fallback: null },
      ce(FeetMesh, { scale: modelScale }),
      ce(OrbitControls, {
        enablePan: false,
        enableZoom: true,
        autoRotate,
        autoRotateSpeed: 0.8,
        minPolarAngle: 0,
        maxPolarAngle: Math.PI,
      })
    )
  );
}

interface FeetModel3DProps {
  width?: string | number;
  height?: string | number;
  modelScale?: number;
  autoRotate?: boolean;
  style?: React.CSSProperties;
}

export default function FeetModel3D({
  width = "100%",
  height = "100%",
  modelScale = 1.0,
  autoRotate = false,
  style,
}: FeetModel3DProps) {
  return (
    <div style={{ width, height, ...style }}>
      <Canvas
        camera={{ position: [0, 3.5, 4.0], fov: 45 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
      >
        <SceneContents modelScale={modelScale} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
