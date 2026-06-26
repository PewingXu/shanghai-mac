import React, { Suspense, useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const ce = React.createElement;
const MODEL_URL = "/assets/models/feet-3d-model.glb";
const LOCKED_VIEW_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

useGLTF.preload(MODEL_URL);

function FeetMesh({ scale, lockedView }: { scale: number; lockedView: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const model = useMemo(() => scene.clone(true), [scene]);

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

  return ce("primitive", {
    object: model,
    scale: [scale, scale, scale],
    position: lockedView ? [0, -0.05, 0] : [0, -0.3, 0],
    rotation: lockedView ? LOCKED_VIEW_ROTATION : [Math.PI * 0.58, 0, 0],
  });
}

function SceneContents({
  modelScale,
  autoRotate,
  lockedView,
}: {
  modelScale: number;
  autoRotate: boolean;
  lockedView: boolean;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (lockedView) {
      camera.position.set(0, 0, 5.8);
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
      ce(FeetMesh, { scale: modelScale, lockedView }),
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
}

export default function FeetModel3D({
  width = "100%",
  height = "100%",
  modelScale = 1.0,
  autoRotate = false,
  lockedView = false,
  style,
}: FeetModel3DProps) {
  return (
    <div style={{ position: "relative", width, height, ...style }}>
      <Canvas
        camera={{ position: lockedView ? [0, 0, 5.8] : [0, 3.5, 4.0], fov: lockedView ? 26 : 45 }}
        style={{ background: "transparent" }}
        gl={{ alpha: true, antialias: true }}
      >
        <SceneContents
          modelScale={modelScale}
          autoRotate={autoRotate}
          lockedView={lockedView}
        />
      </Canvas>
    </div>
  );
}
