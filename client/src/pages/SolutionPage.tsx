/**
 * SolutionPage — 步骤4：解决方案
 *
 * 左右分栏：左侧 3D 晶格鞋垫（StlInsoleViewer，移植自旧项目）+ 左/右脚切换；
 * 右侧解决方案面板（足弓状态 / 鞋垫尺寸 / 鞋垫厚度）。
 *
 * 三个交互态：
 *  - main     主视图
 *  - drawer   鞋垫参数调节抽屉（厚度 + 软硬）
 *  - download 双脚 3D 鞋垫下载弹窗
 *
 * 鞋垫参数 / STL 导出逻辑移植自旧项目 foot-pressure-report。
 */
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useApp } from "@/contexts/AppContext";
import { useDeviceConnectionStatus } from "@/hooks/useDeviceConnectionStatus";
// 解决方案页采用左白右橙的分屏背景（见下方 SplitBackground），不复用全屏橙色 PageBackground
import { StlInsoleViewer, type StlInsoleParams } from "@/components/StlInsoleViewer";
import { STYLE_DEFS, STYLE_ORDER, productBaseHeightMm, personalDeform, ZERO_DEFORM, type InsoleStyle, type DeformMm } from "@/lib/insoleModel";
import {
  getArchLevelColor,
  getArchDesignLogic,
  type InsoleParams,
} from "@/lib/insoleLogic";
import {
  loadSolution,
  solutionFromPythonData,
  type FootSolution,
  type SolutionData,
} from "@/lib/solutionData";
import { lookupInsoleSize } from "@/lib/insoleSize";
import { exportStlInsoleSTL, exportStlInsoleGLTF } from "@/lib/stlInsoleExporter";

// ─── 配色 ─────────────────────────────────────────────────────────────────────
const C = {
  primary: "#FF8400",
  primaryDeep: "#F08614",
  dark: "#17191C",
  sub: "#929EAB",
  panel: "rgba(255,255,255,0.82)",
  border: "rgba(225,203,180,0.55)",
  insoleColor: "#ECECEC", // 默认灰白色（取自晶格鞋垫材质色）
};

type Side = "left" | "right";
type Overlay = "main" | "drawer" | "download";

// 可选鞋垫颜色（3D 预览 / STL 导出共用）
const INSOLE_COLORS: { name: string; value: string }[] = [
  { name: "灰白", value: "#ECECEC" },
  { name: "暖橙", value: "#F0975A" },
  { name: "天蓝", value: "#6AA6F0" },
  { name: "薄荷", value: "#5FD0B0" },
  { name: "石墨", value: "#5A5F66" },
  { name: "米白", value: "#ECE7DF" },
];

interface FootState {
  params: InsoleParams;
  /** 整垫软硬（Shore A）；晶格密度档位见 params.latticeDensity */
  hardness: number;
  shoeSize: number;
}

function toFootState(fs: FootSolution): FootState {
  return { params: { ...fs.params }, hardness: fs.hardness, shoeSize: fs.shoeSize };
}
function toStlParams(fs: FootState): StlInsoleParams {
  return { ...fs.params, hardness: fs.hardness };
}
/**
 * 顶面隆起量(mm)：相对「标准成品垫原生几何」的完整个性化量。
 * 此前算的是「当前值 − 系统推荐值」，未动滑块时恒为 0 ——
 * 等于系统按足弓等级算出的矫正量既没进预览、也没进导出的 STL。
 */
function toDeform(cur: FootState, style: InsoleStyle): DeformMm {
  return personalDeform(cur.params, style);
}

// ─── 页面背景：左白右橙分屏（右橙内嵌自 background.svg，左白内嵌自 左侧白色背景.svg） ─
// 分屏点 1278/1920 ≈ 66.56%（左白），右侧 ≈ 33.44%（橙色）
const ORANGE_LEFT = "max(33.44%, 480px)"; // 橙色区宽度 / 白区右缘
function SplitBackground() {
  return (
    <>
      {/* 底：全屏橙色渐变 + 右侧流动色块（background.svg） */}
      <svg
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }}
      >
        <defs>
          <linearGradient x1="0.5" y1="0" x2="0.5" y2="1" id="bgGrad">
            <stop offset="0%" stopColor="#FFF8ED" stopOpacity="1" />
            <stop offset="100%" stopColor="#FFC283" stopOpacity="1" />
          </linearGradient>
          <mask id="bgMask" style={{ maskType: "alpha" }} maskUnits="userSpaceOnUse" x="1608" y="-65" width="4152" height="1330">
            <rect x="3840" y="0" width="1920" height="1080" rx="0" fill="#FFFFFF" fillOpacity="1" transform="matrix(-1,0,0,1,7680,0)" />
          </mask>
        </defs>
        <rect x="0" y="0" width="1920" height="1080" rx="0" fill="url(#bgGrad)" fillOpacity="1" />
        <g transform="matrix(-1,0,0,1,3840,0)" mask="url(#bgMask)">
          <path
            d="M1860.83961,-58.9394259C1711.869431,-30.241562000000002,1609.931814,91.82542000000001,1633.3471925,214.09447999999998C1667.864685,393.9614,1884.65865,447.71942,1916.5520000000001,613.6416C1948.24356,779.36163,1766.57256,909.71466,1801.09006,1089.5815C1824.50542,1211.6484,1964.19019,1287.6372,2113.16037,1258.9396C2262.13055,1230.2413,2364.06805,1108.1746,2340.65283,985.9052999999999C2306.1352500000003,806.03845,2089.34128,752.2804,2057.44791,586.35822C2025.75647,420.63815,2207.42749,290.28522,2172.90991,110.41833C2149.69635,-11.648581999999998,2009.80975,-87.637291,1860.83961,-58.9394259Z"
            fill="#FFE9C9"
            fillOpacity="1"
            style={{ mixBlendMode: "multiply" }}
          />
        </g>
      </svg>
      {/* 左侧白色渐变面板（左侧白色背景.svg：#FFFFFF → #FFF4EC，顶部约 42.5% 纯白后过渡） */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          right: ORANGE_LEFT,
          background: "linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 42.5%, #FFF4EC 100%)",
          zIndex: 0,
        }}
      />
      {/* 分屏缝隙柔光 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          right: `calc(${ORANGE_LEFT})`,
          width: "60px",
          background: "linear-gradient(90deg, transparent, rgba(255,214,160,0.22))",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    </>
  );
}

// ─── 通用子组件 ───────────────────────────────────────────────────────────────
function SectionTitle({ zh, en, right, info = true }: { zh: string; en: string; right?: React.ReactNode; info?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "16px", fontWeight: 800, color: "#17191C", letterSpacing: "0.02em" }}>{zh}</span>
        <span style={{ fontSize: "12px", color: "#A4906C", fontWeight: 500 }}>{en}</span>
        {info && <InfoIcon />}
      </div>
      {right}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "14px 18px", boxShadow: "0 6px 22px rgba(190,120,40,0.10)" }}>
      {children}
    </div>
  );
}

// ⓘ 信息图标
function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.55 }}>
      <circle cx="8" cy="8" r="7" stroke="#9A8158" strokeWidth="1.2" />
      <circle cx="8" cy="4.6" r="0.9" fill="#9A8158" />
      <rect x="7.2" y="6.6" width="1.6" height="5" rx="0.8" fill="#9A8158" />
    </svg>
  );
}

function PillButton({ children, onClick, filled }: { children: React.ReactNode; onClick?: () => void; filled?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: "30px",
        padding: "0 14px",
        borderRadius: "8px",
        border: filled ? "none" : `1.5px solid ${C.primary}`,
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: 600,
        color: filled ? "#fff" : C.primaryDeep,
        background: filled ? C.primary : "transparent",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        transition: "all 0.18s",
      }}
    >
      {children}
    </button>
  );
}

// ─── 足弓状态光谱条 ───────────────────────────────────────────────────────────
const ARCH_LABELS = ["重度高弓", "中度高弓", "轻度高弓", "正常足", "轻度扁平", "中度扁平", "重度扁平"];

function ArchSpectrum({ params }: { params: InsoleParams }) {
  const level = params.archLevel; // 1-7
  const levelColor = getArchLevelColor(level);
  // 三角标记定位在第 level 段中心
  const markerPct = ((level - 0.5) / 7) * 100;
  const baseMm = (params.baseThickness * 10).toFixed(1);

  return (
    <div>
      {/* 渐变光谱条 + 下三角标记 */}
      <div style={{ position: "relative", marginTop: "14px", marginBottom: "7px" }}>
        {/* 三角标记 */}
        <div style={{ position: "absolute", top: "-12px", left: `${markerPct}%`, transform: "translateX(-50%)" }}>
          <div style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: `8px solid ${levelColor}` }} />
        </div>
        <div style={{ display: "flex", gap: "3px" }}>
          {[1, 2, 3, 4, 5, 6, 7].map((l, i) => (
            <div
              key={l}
              style={{
                flex: 1,
                height: "11px",
                background: getArchLevelColor(l),
                borderRadius: i === 0 ? "6px 0 0 6px" : i === 6 ? "0 6px 6px 0" : 0,
              }}
            />
          ))}
        </div>
      </div>
      {/* 7 标签 */}
      <div style={{ display: "flex", marginBottom: "10px" }}>
        {ARCH_LABELS.map((t, i) => (
          <span key={t} style={{ flex: 1, textAlign: "center", fontSize: "10px", color: i === level - 1 ? levelColor : "#7A6647", fontWeight: i === level - 1 ? 700 : 400 }}>{t}</span>
        ))}
      </div>
      {/* 解读框 */}
      <div style={{ background: "#F7F4EF", borderRadius: "10px", padding: "10px 14px" }}>
        <p style={{ margin: "0 0 5px", fontSize: "12px", color: "#5A4A30", lineHeight: 1.6 }}>
          详细解读：足弓状态处于足弓分级中的 L{level} 等级
          <span style={{ color: levelColor, fontWeight: 700 }}>{params.archType}</span>；
        </p>
        <p style={{ margin: "0 0 9px", fontSize: "12px", color: "#5A4A30", lineHeight: 1.6 }}>
          {getArchDesignLogic(level)}。
        </p>
        <div style={{ background: "#FBEFDD", borderRadius: "8px", padding: "8px 12px", fontSize: "12px", color: "#7A5A28", textAlign: "center", lineHeight: 1.5 }}>
          建议：足弓矫正厚度+{params.archCorrection}mm；鞋垫基础厚度{baseMm}mm；足跟高度{params.heelThickness}mm。
        </div>
      </div>
    </div>
  );
}

// ─── 足型尺寸图（鞋垫轮廓 + 标注，鞋垫路径取自 UI/鞋垫.svg） ───────────────────
// 路径自带水平翻转 transform，渲染后占据 0..48（宽）× 0..138（高）
const INSOLE_D = "M91.53944,113.83725C91.567822,119.62596,91.113789,124.61577,88.74427399999999,129.24113C85.991669,134.63741,81.47966,137.49673,75.449469,137.93124C71.22124099999999,138.23958,67.177464,137.53877,63.474216,135.26813C59.189232000000004,132.64709,57.1886282,128.6104,56.1102867,124.01306C54.7481732,118.21033,55.3440976,112.36554,55.9258337,106.52075C56.7345896,98.531471,57.6568537,90.556206,58.309532000000004,82.55291C58.721005,77.36689,58.46561,72.138817,56.961607900000004,67.149025C55.6846266,62.902096,54.1238708,58.711227,52.29353,54.660522C48.12205689,45.423794,47.24235821,35.836658,48.57609487,25.9692C49.3139066,20.43277,50.5341339,15.008469,52.8894558,9.8925285C54.9326262,5.4353523,57.9264393,1.8892335,62.906667999999996,0.62776852C66.978823,-0.40943605,71.079353,-0.24124068,74.896109,1.7350544C76.187284,2.3938191,77.208866,3.5431545,78.500038,4.2019191C83.437698,6.7248487,85.665325,11.392268,88.162529,15.863461C88.73008300000001,16.872635,89.382763,17.881807,89.680721,18.975077C90.10638800000001,20.530888,90.83000899999999,21.932512,91.440125,23.390203C93.270466,27.777302,94.67514,32.374638,95.157566,37.15419C95.427143,39.7472,95.895378,42.326191,95.98049900000001,44.919212C96.150768,50.413589,95.18593200000001,55.795837,93.866394,61.122021C91.86578,69.167366,90.021259,77.268784,90.007069,85.580429C90.007069,91.761604,90.56042500000001,97.942787,90.915142,104.12396C91.113781,107.6,91.36918299999999,111.07603,91.553631,113.85127L91.53944,113.83725Z";
const INSOLE_TF = "matrix(-1,0,0,1,96,0)";

function FootPair({ lengthCm, widthCm, side }: { lengthCm: number; widthCm: number; side: Side }) {
  // 始终画一双脚：左位=左脚形，右位=右脚形（就地水平翻转）。聚焦的一只染橙并加标注。
  const flipRight = "matrix(-1,0,0,1,48,0)";
  const leftFocused = side === "left";
  const ORANGE = "#FFB25E";
  const FADED = "#EAD9C3";
  // 宽度标注线覆盖聚焦（橙色）那只鞋垫的前掌
  const wx1 = leftFocused ? 26 : 78;
  const wx2 = leftFocused ? 69 : 121;
  const wmid = (wx1 + wx2) / 2;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "185px" }}>
      {/* 网格底纹 */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(180,150,110,0.10) 1px,transparent 1px),linear-gradient(90deg,rgba(180,150,110,0.10) 1px,transparent 1px)", backgroundSize: "22px 22px", borderRadius: "10px" }} />
      <svg viewBox="0 0 135 152" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} preserveAspectRatio="xMidYMid meet">
        {/* 长度标注线（左侧，贯穿全高） */}
        <line x1="15" y1="16" x2="15" y2="140" stroke="#C9A06A" strokeWidth="1.1" />
        <line x1="11.5" y1="16" x2="18.5" y2="16" stroke="#C9A06A" strokeWidth="1.1" />
        <line x1="11.5" y1="140" x2="18.5" y2="140" stroke="#C9A06A" strokeWidth="1.1" />
        <text x="7" y="78" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#7A5A28" transform="rotate(-90 7 78)">{lengthCm} cm</text>
        {/* 左脚鞋垫（固定左位、左向） */}
        <g transform="translate(26,16) scale(0.9)">
          <path d={INSOLE_D} transform={INSOLE_TF} fill={leftFocused ? ORANGE : FADED} fillOpacity={leftFocused ? 1 : 0.7} />
        </g>
        {/* 右脚鞋垫（固定右位、右向镜像） */}
        <g transform="translate(78,16) scale(0.9)">
          <g transform={flipRight}>
            <path d={INSOLE_D} transform={INSOLE_TF} fill={leftFocused ? FADED : ORANGE} fillOpacity={leftFocused ? 0.7 : 1} />
          </g>
        </g>
        {/* 宽度标注线（聚焦鞋垫前掌，顶部） */}
        <line x1={wx1} y1="11" x2={wx2} y2="11" stroke="#F08A2E" strokeWidth="1.1" />
        <line x1={wx1} y1="7.5" x2={wx1} y2="14.5" stroke="#F08A2E" strokeWidth="1.1" />
        <line x1={wx2} y1="7.5" x2={wx2} y2="14.5" stroke="#F08A2E" strokeWidth="1.1" />
        <text x={wmid} y="6" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#7A5A28">{widthCm} cm</text>
      </svg>
    </div>
  );
}

// ─── 只读尺寸/厚度行 ──────────────────────────────────────────────────────────
function InfoRow({ label, en, value }: { label: string; en?: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px dashed ${C.border}` }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: "13px", color: C.dark, fontWeight: 500 }}>{label}</span>
        {en && <span style={{ fontSize: "10px", color: C.sub }}>{en}</span>}
      </div>
      <span style={{ fontSize: "15px", fontWeight: 700, color: C.dark, fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}

// ─── 步进 + 滑块行（抽屉/细节复用） ────────────────────────────────────────────
function StepperSliderRow({
  label,
  value,
  min,
  max,
  step,
  unit = "mm",
  prefix = "",
  hints,
  tightHints,
  systemValue,
  noSlider,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  prefix?: string;
  hints?: [string, string];
  tightHints?: boolean;
  systemValue?: number;
  noSlider?: boolean;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  const fmt = (v: number) => (Number.isInteger(step) ? v.toFixed(0) : v.toFixed(1));
  // 双极滑块（min<0）显式带正号，负值 fmt 自带负号
  const fmtSigned = (v: number) => `${min < 0 && v > 0 ? "+" : ""}${fmt(v)}`;
  // 系统值刻度：在轨道上标记该脚的原始系统参数位置
  const sysPct =
    systemValue != null && max > min
      ? Math.max(0, Math.min(100, ((systemValue - min) / (max - min)) * 100))
      : null;
  // 当前值在轨道上的百分比（用于橙色填充与手柄定位）
  const valuePct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  // 手柄内缩定位：圆钮圆心始终留在轨道内（两端各留一个半径），避免探出边缘
  const KN = 18; // 圆钮直径
  const posX = (pct: number) => `calc(${KN / 2}px + (100% - ${KN}px) * ${pct / 100})`;
  // 双极填充：以 0 值位置为锚点，正值向右（橙）/负值向左（蓝）
  const zeroPct = max > min ? Math.max(0, Math.min(100, ((0 - min) / (max - min)) * 100)) : 0;
  const fillStart = Math.min(zeroPct, valuePct);
  const fillEnd = Math.max(zeroPct, valuePct);
  const fillColor = value >= 0 ? C.primary : "#4A90D9";
  // 系统值刻度是否落在已填充(橙/蓝)区间内——被滑块填充覆盖时虚线改白色以保持可见
  const sysCovered = sysPct != null && sysPct >= fillStart - 0.01 && sysPct <= fillEnd + 0.01;

  // 步进按钮：浅奶油胶囊 + 橙色符号（对齐设计稿）
  const StepBtn = ({ dir }: { dir: -1 | 1 }) => (
    <button
      onClick={() => onChange(clamp(value + dir * step))}
      style={{
        width: "40px",
        height: "26px",
        borderRadius: "13px",
        border: "none",
        cursor: "pointer",
        background: "#F4ECE4",
        color: C.primaryDeep,
        fontSize: "17px",
        fontWeight: 700,
        lineHeight: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {dir > 0 ? "+" : "−"}
    </button>
  );

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px", color: C.dark, fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: C.primaryDeep, fontFamily: "monospace", background: "rgba(245,166,35,0.12)", padding: "2px 8px", borderRadius: "6px" }}>
          {prefix}{fmtSigned(value)}{unit}
        </span>
      </div>
      {/* 无滑块：仅左右步进按钮（对齐设计稿抽屉前两项） */}
      {noSlider ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <StepBtn dir={-1} />
          <StepBtn dir={1} />
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <StepBtn dir={-1} />
        <div style={{ flex: 1, position: "relative", height: "20px", display: "flex", alignItems: "center" }}>
          {/* 轨道底（浅褐胶囊） */}
          <div style={{ position: "absolute", inset: 0, borderRadius: "10px", background: "rgba(219,194,168,0.30)" }} />
          {/* 填充：以 0 为锚点，正值橙色向右、负值蓝色向左 */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: posX(fillStart), right: `calc(100% - (${KN / 2}px + (100% - ${KN}px) * ${fillEnd / 100}))`, borderRadius: "10px", background: fillColor }} />
          {/* 系统值刻度线 + 标签 */}
          {sysPct != null && (
            <>
              <div
                style={{
                  position: "absolute",
                  top: "2px",
                  bottom: "2px",
                  left: posX(sysPct),
                  transform: "translateX(-50%)",
                  width: "2px",
                  backgroundImage: `repeating-linear-gradient(${sysCovered ? "#fff" : C.primaryDeep} 0 3px, transparent 3px 6px)`,
                  pointerEvents: "none",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: "23px",
                  left: posX(sysPct),
                  transform: "translateX(-50%)",
                  fontSize: "9px",
                  fontWeight: 600,
                  color: C.primaryDeep,
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                }}
              >
                {prefix}{fmtSigned(systemValue as number)}{unit} 系统值
              </span>
            </>
          )}
          {/* 白色圆钮（内缩，落在橙色内部靠边） */}
          <div style={{ position: "absolute", left: posX(valuePct), top: "50%", transform: "translate(-50%,-50%)", width: `${KN}px`, height: `${KN}px`, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(150,100,30,0.28)", pointerEvents: "none" }} />
          {/* 透明原生 range（负责交互） */}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(clamp(parseFloat(e.target.value)))}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" }}
          />
        </div>
        <StepBtn dir={1} />
      </div>
      )}
      {hints && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: C.sub, marginTop: sysPct != null ? "8px" : "6px", padding: noSlider ? "0" : (tightHints ? "0" : "0 40px") }}>
          {/* tightHints：左端标签居中对齐到 − 按钮下方；
              右端标签靠右对齐、向内(左)生长——长文本(如"+12mm 最大矫正""30mm 最大缓冲")
              不会越过右边缘，短文本(如"+1.5mm支撑")仍贴着 + 按钮。黑色字。 */}
          <span style={tightHints ? { width: "40px", textAlign: "center", whiteSpace: "nowrap", color: C.dark, transform: "translateX(-4px)" } : undefined}>{hints[0]}</span>
          <span style={tightHints ? { textAlign: "right", whiteSpace: "nowrap", color: C.dark, transform: "translateX(-6px)" } : undefined}>{hints[1]}</span>
        </div>
      )}
    </div>
  );
}

// ─── 设备连接徽章 ─────────────────────────────────────────────────────────────
// 状态取自 deviceManager 的广播（见 hooks/useDeviceConnectionStatus）。
// 此前顶栏与底部栏各写死一句「设备连接正常」，与真实连接状态无关，掉线也不变。
function DeviceBadge() {
  const connected = useDeviceConnectionStatus();
  const color = connected ? "#3AD2A3" : "#FF5A2C";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#fff", borderRadius: "16px", padding: "5px 12px", boxShadow: "0 1px 6px rgba(180,120,40,0.12)" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M9 12h6M8 9a3 3 0 0 0 0 6h2M16 9a3 3 0 0 1 0 6h-2" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: "12px", color, fontWeight: 600 }}>{connected ? "设备连接正常" : "设备未连接"}</span>
    </div>
  );
}

// ─── 底部操作栏 ───────────────────────────────────────────────────────────────
function BottomBar({ userName, userId, onBack, onRestart, onDownload }: {
  userName: string; userId: string; onBack?: () => void; onRestart: () => void; onDownload: () => void;
}) {
  const linkBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 600 };
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: "max(33.44%, 480px)", height: "56px", padding: "0 40px", display: "flex", alignItems: "center", gap: "28px", borderTop: "1px solid rgba(200,160,110,0.25)", zIndex: 30 }}>
      <DeviceBadge />
      <span style={{ fontSize: "14px", color: "#5A4A30", marginLeft: "auto" }}>当前用户：{userName} （ID:{userId}）</span>
      <button onClick={onBack} style={{ ...linkBtn, color: "#5A4A30" }}>重新测量</button>
      <button onClick={onRestart} style={{ ...linkBtn, color: "#17191C", textDecoration: "underline", textUnderlineOffset: "3px" }}>结束体验</button>
      <button onClick={onDownload} style={{ ...linkBtn, color: C.primaryDeep }}>下载文件</button>
    </div>
  );
}

// ─── 厚度三条（抽屉/细节复用） ────────────────────────────────────────────────
// drawerMode：抽屉（第2页）里前两项无滑块，仅步进；细节面板（第3页）三项均带滑块。
function ThicknessSliders({ fs, sys, onParams, drawerMode, style }: { fs: FootState; sys?: FootState; onParams: (p: Partial<InsoleParams>) => void; drawerMode?: boolean; style: InsoleStyle }) {
  // 成品垫(proportional)：基础厚度默认=原生高度按足长换算(约 50~57mm)，量程较大；
  // 调节方式与标准垫一致——抽屉里只给 −/+ 步进，不出滑块。
  const proportional = STYLE_DEFS[style].heightMode === "proportional";
  return (
    <>
      {proportional ? (
        <StepperSliderRow
          label="基础厚度（随足长）"
          value={fs.params.baseThickness * 10}
          min={20} max={70} step={0.5}
          hints={drawerMode ? undefined : ["20mm", "70mm"]}
          tightHints
          systemValue={drawerMode ? undefined : (sys ? sys.params.baseThickness * 10 : undefined)}
          noSlider={drawerMode}
          onChange={(v) => onParams({ baseThickness: v / 10 })}
        />
      ) : (
        <StepperSliderRow
          label="基础厚度（压力自适应）"
          value={fs.params.baseThickness * 10}
          min={1.5} max={6} step={0.1}
          hints={drawerMode ? undefined : ["1.5mm", "6.0mm 最大"]}
          tightHints
          systemValue={drawerMode ? undefined : (sys ? sys.params.baseThickness * 10 : undefined)}
          noSlider={drawerMode}
          onChange={(v) => onParams({ baseThickness: v / 10 })}
        />
      )}
      <StepperSliderRow
        label="足弓矫正厚度"
        prefix="+"
        value={fs.params.archCorrection}
        min={1} max={12} step={0.1}
        hints={["+1mm 维持", "+12mm 最大矫正"]}
        tightHints
        systemValue={drawerMode ? undefined : (sys ? sys.params.archCorrection : undefined)}
        noSlider={drawerMode}
        onChange={(v) => onParams({ archCorrection: Math.round(v * 10) / 10 })}
      />
      <StepperSliderRow
        label="足跟缓冲厚度"
        value={fs.params.heelThickness}
        min={0} max={30} step={1}
        hints={["0mm 无缓冲", "30mm 最大缓冲"]}
        tightHints
        systemValue={drawerMode ? undefined : (sys ? sys.params.heelThickness : undefined)}
        onChange={(v) => onParams({ heelThickness: v })}
      />
    </>
  );
}

// ─── 厚度胶囊行 ───────────────────────────────────────────────────────────────
function ThickPillRow({ label, value, adjusted }: { label: string; value: string; adjusted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFF2E4", borderRadius: "12px", padding: "10px 16px", marginBottom: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#17191C" }}>{label}</span>
        <InfoIcon size={13} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {adjusted && <span style={{ fontSize: "12px", color: C.primaryDeep, fontWeight: 500 }}>已调整</span>}
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#17191C", fontFamily: "monospace" }}>{value}</span>
      </div>
    </div>
  );
}

// ─── 输入框尺寸行（默认置空，由用户手填） ────────────────────────────────────
function SizeInputRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span style={{ fontSize: "14px", fontWeight: 600, color: "#17191C" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <input
          type="number"
          step={0.5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: "64px", height: "30px", borderRadius: "8px", border: `1.5px solid ${C.primary}`, background: "#fff", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#17191C", outline: "none" }}
        />
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#17191C" }}>cm</span>
      </div>
    </div>
  );
}

// ─── 自定义顶栏（左白右橙 + 设备连接 + 步骤） ─────────────────────────────────
const SOLUTION_STEPS = [
  { id: 1, label: "创建" },
  { id: 2, label: "测量" },
  { id: 3, label: "揭晓" },
  { id: 4, label: "方案" },
];

function SolutionTopBar() {
  return (
    <header style={{ position: "fixed", top: 0, left: 0, right: 0, height: "72px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 40px", zIndex: 100 }}>
      {/* 左侧 Logo */}
      <img src="/assets/icons/home-page/top-left-logo.svg" alt="ACIKI 动态足底压力解析系统" style={{ height: "48px", objectFit: "contain" }} />
      {/* 右侧 设备状态 + 步骤 */}
      <div style={{ display: "flex", alignItems: "center", gap: "26px" }}>
        <DeviceBadge />
        <div style={{ display: "flex", alignItems: "center" }}>
          {SOLUTION_STEPS.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: C.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700 }}>{s.id}</div>
                <span style={{ fontSize: "11px", color: C.primaryDeep, fontWeight: 500 }}>{s.label}</span>
              </div>
              {i < SOLUTION_STEPS.length - 1 && (
                <div style={{ width: "28px", height: "1.5px", background: C.primary, marginBottom: "16px", opacity: 0.7 }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
interface SolutionPageProps {
  onRestart: () => void;
  onHistory: () => void;
  onBack?: () => void;
  onViewReport?: () => void;
}

export default function SolutionPage({ onRestart, onHistory, onBack, onViewReport }: SolutionPageProps) {
  const { currentUser, analysis } = useApp();

  const [side, setSide] = useState<Side>("left");
  const [overlay, setOverlay] = useState<Overlay>("main");
  // 当前鞋垫颜色（3D 预览 + STL 导出）
  const [insoleColor, setInsoleColor] = useState<string>(C.insoleColor);
  // 当前鞋垫样式（整双统一：舒缓 / 运动 / 标准）
  const [insoleStyle, setInsoleStyle] = useState<InsoleStyle>("comfort");

  // 已提交参数 / 加载默认值 / 编辑草稿
  const [committed, setCommitted] = useState<{ left: FootState; right: FootState } | null>(null);
  const [defaults, setDefaults] = useState<{ left: FootState; right: FootState } | null>(null);
  const [draft, setDraft] = useState<{ left: FootState; right: FootState } | null>(null);
  // 分析原始值（base 为压力自适应厚度）；成品垫的基础厚度按样式另行换算，此处保留标准垫回退用
  const [analysisBase, setAnalysisBase] = useState<{ left: FootState; right: FootState } | null>(null);

  // 保存成功提示（顶部居中绿色胶囊）
  const [savedTip, setSavedTip] = useState(false);
  // 离开守卫弹窗
  const [confirm, setConfirm] = useState<null | "remeasure" | "finish">(null);
  // 用户手填的鞋垫尺寸（默认置空，用于校验；不回写测量参数）
  const [insoleSize, setInsoleSize] = useState<{ left: { length: string; width: string }; right: { length: string; width: string } }>({
    left: { length: "", width: "" },
    right: { length: "", width: "" },
  });

  // 解决方案参数来自本次测量/历史回放的分析结果，与报告页同一份 analysis.python.data。
  // 兜底顺序见 solutionData.ts 顶部注释；走到 DEMO 时 backend=false，页面给出提示。
  const [isDemoData, setIsDemoData] = useState(false);

  useEffect(() => {
    let alive = true;
    const apply = (data: SolutionData) => {
      if (!alive) return;
      setCommitted({ left: toFootState(data.left), right: toFootState(data.right) });
      setDefaults({ left: toFootState(data.left), right: toFootState(data.right) });
      setAnalysisBase({ left: toFootState(data.left), right: toFootState(data.right) });
      setIsDemoData(!data.backend);
    };

    const pyData = analysis?.python?.success ? analysis.python.data : null;
    if (pyData) {
      // 常规路径：复用已算好的结果，不重跑后端
      apply(solutionFromPythonData(pyData));
      return () => { alive = false; };
    }
    // 兜底：只有原始帧时现场跑一次；两者都没有则 loadSolution 返回 DEMO
    loadSolution(analysis?.rawFrames).then(apply);
    return () => { alive = false; };
  }, [analysis]);

  // 按样式换算基础厚度：成品垫(proportional) = 原生高度按足长等比(productBaseHeightMm)，
  // 标准垫(param) = 分析的压力自适应厚度。切换样式时把 base 重置为该样式默认值（其余参数保留）。
  useEffect(() => {
    if (!analysisBase) return;
    const styleBaseCm = (s: Side): number => {
      const len = analysisBase[s].params.footLength;
      const mm = productBaseHeightMm(insoleStyle, len);
      return mm != null ? mm / 10 : analysisBase[s].params.baseThickness;
    };
    const withBase = (prev: { left: FootState; right: FootState } | null) =>
      prev
        ? {
            left: { ...prev.left, params: { ...prev.left.params, baseThickness: styleBaseCm("left") } },
            right: { ...prev.right, params: { ...prev.right.params, baseThickness: styleBaseCm("right") } },
          }
        : prev;
    setCommitted(withBase);
    setDefaults(withBase);
    setDraft(withBase);
  }, [insoleStyle, analysisBase]);

  // 编辑期用 draft，否则用 committed
  const editing = overlay === "drawer";
  const viewState = editing && draft ? draft : committed;

  const stlLeft = useMemo<StlInsoleParams | null>(() => (viewState ? toStlParams(viewState.left) : null), [viewState]);
  const stlRight = useMemo<StlInsoleParams | null>(() => (viewState ? toStlParams(viewState.right) : null), [viewState]);
  const deformLeft = useMemo<DeformMm>(() => (viewState ? toDeform(viewState.left, insoleStyle) : ZERO_DEFORM), [viewState, insoleStyle]);
  const deformRight = useMemo<DeformMm>(() => (viewState ? toDeform(viewState.right, insoleStyle) : ZERO_DEFORM), [viewState, insoleStyle]);

  if (!committed || !viewState || !stlLeft || !stlRight) {
    return (
      <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden" }}>
        <SplitBackground />
        <SolutionTopBar />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: "14px" }}>
          正在生成解决方案…
        </div>
      </div>
    );
  }

  const cur = viewState[side];
  const sideLabel = side === "left" ? "左" : "右";

  // 匹配鞋码：用户已填鞋垫长度→按输入换算；未填→用分析报告结果
  const shoeSizeFor = (s: Side) => {
    const len = parseFloat(insoleSize[s].length);
    if (!Number.isNaN(len) && len > 0) return lookupInsoleSize(len, "adult_male").shoeSize;
    return committed[s].shoeSize;
  };

  // 脚型图的长/宽标注：用户填了输入就用输入值（随输入实时变化），未填则回退分析值
  const dimFor = (s: Side) => {
    const lv = parseFloat(insoleSize[s].length);
    const wv = parseFloat(insoleSize[s].width);
    return {
      lengthCm: Number.isFinite(lv) && lv > 0 ? lv : Math.round(committed[s].params.footLength),
      widthCm: Number.isFinite(wv) && wv > 0 ? wv : Math.round(committed[s].params.footWidth),
    };
  };

  // 厚度参数是否被实际调整过（当前值 ≠ 系统默认值）→ 决定是否显示「已调整」
  const dp = defaults?.[side].params;
  const cp = committed[side].params;
  const adjusted = {
    arch: !!dp && Math.abs(cp.archCorrection - dp.archCorrection) > 1e-6,
    base: !!dp && Math.abs(cp.baseThickness - dp.baseThickness) > 1e-6,
    heel: !!dp && Math.abs(cp.heelThickness - dp.heelThickness) > 1e-6,
    hardness: !!defaults && committed[side].hardness !== defaults[side].hardness,
  };

  // ── 编辑动作 ──
  const cloneFoot = (f: FootState): FootState => ({ params: { ...f.params }, hardness: f.hardness, shoeSize: f.shoeSize });
  const openDraft = (next: Overlay) => {
    setDraft({ left: cloneFoot(committed.left), right: cloneFoot(committed.right) });
    setOverlay(next);
  };
  const editParams = (p: Partial<InsoleParams>) =>
    setDraft((d) => (d ? { ...d, [side]: { ...d[side], params: { ...d[side].params, ...p } } } : d));
  const editHardness = (h: number) =>
    setDraft((d) => (d ? { ...d, [side]: { ...d[side], hardness: h } } : d));
  const resetDefaults = () => {
    if (!defaults) return;
    setDraft((d) => (d ? { ...d, [side]: cloneFoot(defaults[side]) } : d));
    toast.info(`已恢复${sideLabel}脚默认参数`);
  };
  // 仅重置软硬（Shore A）到系统值
  const resetSoftness = () => {
    if (!defaults) return;
    setDraft((d) => (d ? { ...d, [side]: { ...d[side], hardness: defaults[side].hardness } } : d));
    toast.info(`已重置${sideLabel}脚软硬`);
  };
  const saveDraft = () => {
    if (draft) setCommitted(draft);
    setDraft(null);
    setOverlay("main");
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 2000);
  };
  const cancelDraft = () => { setDraft(null); setOverlay("main"); };

  // ── 离开守卫：鞋垫尺寸是否已填满四项 ──
  const sizesFilled =
    !!insoleSize.left.length && !!insoleSize.left.width &&
    !!insoleSize.right.length && !!insoleSize.right.width;
  const handleRemeasure = () => { if (sizesFilled) onBack?.(); else setConfirm("remeasure"); };
  const handleFinish = () => { if (sizesFilled) onRestart(); else setConfirm("finish"); };

  // ── STL 下载 ──
  const handleDownload = async (fmt: "stl" | "glb") => {
    const name = currentUser?.name;
    try {
      toast.info(`正在生成 ${fmt.toUpperCase()} 文件，请稍候…`);
      const exporter = fmt === "stl" ? exportStlInsoleSTL : exportStlInsoleGLTF;
      for (const f of ["left", "right"] as const) {
        const s = committed[f];
        const d = toDeform(s, insoleStyle);
        await exporter(insoleStyle, f, s.params.footLength, s.params.footWidth, s.params.archCorrection, s.params.baseThickness, s.params.heelThickness, insoleColor, name, d);
      }
      toast.success(`双脚鞋垫 ${fmt.toUpperCase()} 文件已开始下载`, { description: "可直接用于 3D 打印" });
    } catch (err) {
      console.error(err);
      toast.error("文件导出失败，请重试");
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif' }}>
      <SplitBackground />
      <SolutionTopBar />

      <main style={{ flex: 1, display: "flex", gap: "28px", padding: "20px 40px 84px", position: "relative", zIndex: 1, marginTop: "72px", minHeight: 0 }}>
        {/* 左侧：3D 鞋垫 */}
        <section style={{ flex: 1, position: "relative", minHeight: "440px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#5A3A1A" }}>{sideLabel}脚晶格体3D鞋垫展示</h2>
            <div style={{ display: "flex", gap: "6px", background: "rgba(255,255,255,0.6)", padding: "4px", borderRadius: "10px", marginRight: "clamp(32px, 6vw, 96px)" }}>
              {(["left", "right"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    height: "30px", padding: "0 18px", borderRadius: "8px", border: "none", cursor: "pointer",
                    fontSize: "13px", fontWeight: 600,
                    color: side === s ? "#fff" : "#B2A699",
                    background: side === s ? C.primary : "#EDE5DC",
                    transition: "all 0.18s",
                  }}
                >
                  {s === "left" ? "左脚鞋垫" : "右脚鞋垫"}
                </button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: "440px", background: "transparent", position: "relative" }}>
            <StlInsoleViewer activeFoot={side} style={insoleStyle} color={insoleColor} leftParams={stlLeft} rightParams={stlRight} leftDeform={deformLeft} rightDeform={deformRight} />
            {/* 左上悬浮控件：鞋垫颜色 + 其正下方的鞋垫样式 */}
            <div style={{ position: "absolute", top: "12px", left: "12px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "10px", zIndex: 5 }}>
              {/* 鞋垫颜色切换 */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.82)", backdropFilter: "blur(4px)", borderRadius: "14px", padding: "8px 14px", boxShadow: "0 2px 10px rgba(160,110,40,0.14)" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#5A3A1A" }}>鞋垫颜色</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  {INSOLE_COLORS.map((c) => {
                    const active = insoleColor === c.value;
                    return (
                      <button
                        key={c.value}
                        title={c.name}
                        onClick={() => setInsoleColor(c.value)}
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          background: c.value,
                          cursor: "pointer",
                          border: active ? "2px solid #F08614" : "2px solid #fff",
                          boxShadow: active ? "0 0 0 1.5px #F08614" : "0 1px 3px rgba(0,0,0,0.18)",
                          padding: 0,
                          transition: "all 0.15s",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              {/* 鞋垫样式切换（整双统一）—— 位于鞋垫颜色正下方 */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.82)", backdropFilter: "blur(4px)", borderRadius: "14px", padding: "8px 12px", boxShadow: "0 2px 10px rgba(160,110,40,0.14)" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#5A3A1A" }}>鞋垫样式</span>
                <div style={{ display: "flex", gap: "4px", background: "#EDE5DC", padding: "3px", borderRadius: "9px" }}>
                  {STYLE_ORDER.map((st) => {
                    const active = insoleStyle === st;
                    return (
                      <button
                        key={st}
                        onClick={() => setInsoleStyle(st)}
                        style={{
                          height: "26px", padding: "0 12px", borderRadius: "7px", border: "none", cursor: "pointer",
                          fontSize: "12px", fontWeight: 600,
                          color: active ? "#fff" : "#8A6A40",
                          background: active ? C.primary : "transparent",
                          transition: "all 0.16s",
                        }}
                      >
                        {STYLE_DEFS[st].label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：方案面板 */}
        <aside style={{ width: "440px", minWidth: "420px", display: "flex", flexDirection: "column", gap: "12px", overflow: "hidden", maxHeight: "calc(100vh - 150px)", padding: "2px 8px 0 4px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "2px" }}>
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#17191C" }}>{sideLabel}脚解决方案</span>
            <button
              onClick={onViewReport}
              style={{ height: "34px", padding: "0 16px", borderRadius: "10px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#fff", background: C.primary, display: "inline-flex", alignItems: "center", gap: "6px", boxShadow: "0 3px 10px rgba(245,166,35,0.3)" }}
            >
              返回分析报告 ›
            </button>
          </div>

          {/* 足弓状态 */}
          <Card>
            <SectionTitle zh="足弓状态" en="Foot arch status" />
            {/* 静默兜底曾被误当真实数据（报告页同款提示），演示值必须显式标注 */}
            {isDemoData && (
              <div
                style={{
                  marginBottom: "8px",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  background: "rgba(255,90,44,0.10)",
                  color: "#FF5A2C",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                演示数据：未接入本次测量分析结果，以下参数不可用于生产
              </div>
            )}
            <ArchSpectrum params={committed[side].params} />
          </Card>

          {/* 鞋垫尺寸 */}
          <Card>
            <SectionTitle zh="鞋垫尺寸" en="Foot dimensions" info={false} />
            <div style={{ display: "flex", gap: "14px" }}>
              {/* 脚型图 */}
              <div style={{ flex: "0 0 150px" }}>
                <FootPair lengthCm={dimFor(side).lengthCm} widthCm={dimFor(side).widthCm} side={side} />
              </div>
              {/* 输入区 */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ background: "#FFF2E4", borderRadius: "12px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <SizeInputRow label={`${sideLabel}鞋垫长度`} value={insoleSize[side].length} onChange={(v) => setInsoleSize((s) => ({ ...s, [side]: { ...s[side], length: v } }))} />
                  <div style={{ height: "1px", background: "rgba(200,150,90,0.25)" }} />
                  <SizeInputRow label={`${sideLabel}鞋垫宽度`} value={insoleSize[side].width} onChange={(v) => setInsoleSize((s) => ({ ...s, [side]: { ...s[side], width: v } }))} />
                </div>
                <div style={{ background: "#FFF2E4", borderRadius: "12px", padding: "12px 14px", fontSize: "14px", fontWeight: 700, color: "#17191C" }}>
                  匹配鞋码：中国{shoeSizeFor(side)}码
                </div>
              </div>
            </div>
          </Card>

          {/* 鞋垫厚度 */}
          <Card>
            <SectionTitle
              zh="鞋垫厚度" en="Insole thickness"
              right={
                <button onClick={() => openDraft("drawer")} style={{ background: "none", border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "5px", color: C.primaryDeep, fontSize: "14px", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: "3px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="7" cy="8" r="2.4" stroke={C.primaryDeep} strokeWidth="1.6" /><circle cx="16" cy="16" r="2.4" stroke={C.primaryDeep} strokeWidth="1.6" /><path d="M9.4 8H20M4 16h9.6" stroke={C.primaryDeep} strokeWidth="1.6" strokeLinecap="round" /></svg>
                  调整参数
                </button>
              }
            />
            <ThickPillRow label="足弓矫正厚度" value={`+${committed[side].params.archCorrection}mm`} adjusted={adjusted.arch} />
            <ThickPillRow label="基础厚度" value={`${(committed[side].params.baseThickness * 10).toFixed(1)}mm`} adjusted={adjusted.base} />
            <ThickPillRow label="足跟缓冲厚度" value={`${committed[side].params.heelThickness}mm`} adjusted={adjusted.heel} />
          </Card>
        </aside>
      </main>

      <BottomBar
        userName={currentUser?.name ?? "—"}
        userId={String(currentUser?.id ?? "—")}
        onBack={handleRemeasure}
        onRestart={handleFinish}
        onDownload={() => setOverlay("download")}
      />

      {/* ── 鞋垫参数调节抽屉（厚度 + 软硬） ── */}
      {overlay === "drawer" && (
        <>
          <SidebarDim />
          <DrawerPanel title="鞋垫参数调节" onReset={resetDefaults}>
            <ThicknessSliders fs={cur} sys={defaults?.[side]} onParams={editParams} drawerMode style={insoleStyle} />

            {/* 软硬调节：Shore A 硬度 */}
            <DetailSectionHeader title="软硬调节" onReset={resetSoftness} style={{ marginTop: "8px" }} />
            <StepperSliderRow label="鞋垫软硬" value={cur.hardness} min={20} max={60} step={1} unit="Shore A" hints={["软", "硬"]} tightHints systemValue={defaults?.[side].hardness} onChange={(v) => editHardness(v)} />

            <DrawerFooter
              onCancel={cancelDraft}
              onSave={saveDraft}
            />
          </DrawerPanel>
        </>
      )}

      {/* ── 双脚下载弹窗 ── */}
      {overlay === "download" && (
        <DualFootModal
          committed={committed}
          onClose={() => setOverlay("main")}
          onDownload={handleDownload}
          stlLeft={toStlParams(committed.left)}
          stlRight={toStlParams(committed.right)}
          deformLeft={toDeform(committed.left, insoleStyle)}
          deformRight={toDeform(committed.right, insoleStyle)}
          color={insoleColor}
          style={insoleStyle}
          shoeSizeLeft={shoeSizeFor("left")}
          shoeSizeRight={shoeSizeFor("right")}
        />
      )}

      {/* ── 保存成功提示（顶部居中绿色胶囊） ── */}
      {savedTip && <SaveSuccessToast />}

      {/* ── 离开守卫弹窗 ── */}
      {confirm === "remeasure" && (
        <ConfirmModal
          title="重新测量"
          body="左/右脚鞋垫尺寸未填写，已为你保存当前内容到历史记录。是否继续重新测量？"
          confirmLabel="重新测量"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); onBack?.(); }}
        />
      )}
      {confirm === "finish" && (
        <ConfirmModal
          title="结束体验"
          body="左/右脚鞋垫尺寸未填写，方案将自动保存到历史记录。是否结束体验？"
          confirmLabel="结束体验"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); onRestart(); }}
        />
      )}

      <style>{`
        @keyframes drawerUp { from { opacity:0; transform: translateY(24px); } to { opacity:1; transform: translateY(0); } }
        @keyframes modalIn { from { opacity:0; transform: scale(0.97); } to { opacity:1; transform: scale(1); } }
        @keyframes slideDown { from { opacity:0; transform: translate(-50%,-12px); } to { opacity:1; transform: translate(-50%,0); } }
      `}</style>
    </div>
  );
}

// ─── 右侧边栏弱化蒙版（抽屉/细节打开时铺在右侧信息区上，浮层之下） ───────────────
function SidebarDim() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "max(33.44%, 480px)",
        background: "#9E958C",
        opacity: 0.8,
        zIndex: 35,
      }}
    />
  );
}

// ─── 抽屉容器（白底、放大，对齐设计稿第二页） ──────────────────────────────────
function DrawerPanel({ title, onReset, children }: { title: string; onReset: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", right: "16px", bottom: "16px", width: "min(500px, 40vw)", minWidth: "440px", maxHeight: "calc(100vh - 120px)", overflowY: "auto", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 16px 56px rgba(150,90,20,0.24)", padding: "22px 24px", zIndex: 40, animation: "drawerUp 0.25s cubic-bezier(0.23,1,0.32,1)", border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
        <span style={{ fontSize: "16px", fontWeight: 700, color: C.dark }}>{title}</span>
        <button onClick={onReset} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: C.primaryDeep, fontWeight: 600 }}>↺ 默认参数</button>
      </div>
      {children}
    </div>
  );
}

function DrawerFooter({ leftBtn, onCancel, onSave, saveLabel = "保存" }: { leftBtn?: { label: string; onClick: () => void }; onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", paddingTop: "14px", borderTop: `1px solid ${C.border}` }}>
      {leftBtn && (
        <button onClick={leftBtn.onClick} style={{ background: "none", border: `1.5px solid ${C.primary}`, borderRadius: "8px", height: "38px", padding: "0 14px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: C.primaryDeep }}>
          {leftBtn.label}
        </button>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
        <button onClick={onCancel} style={{ background: "rgba(255,220,150,0.15)", border: `1.5px solid #F0C080`, borderRadius: "8px", height: "38px", padding: "0 22px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: C.primaryDeep }}>取消</button>
        <button onClick={onSave} style={{ background: C.primary, border: "none", borderRadius: "8px", height: "38px", padding: "0 26px", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#fff" }}>{saveLabel}</button>
      </div>
    </div>
  );
}

// section 标题 + 重置（抽屉内软硬调节复用）
function DetailSectionHeader({ title, onReset, style }: { title: string; onReset: () => void; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: C.dark }}>{title}</span>
        <InfoIcon size={13} />
      </div>
      <button onClick={onReset} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: C.primaryDeep, fontWeight: 600 }}>↺ 重置</button>
    </div>
  );
}

// ─── 保存成功提示（顶部居中绿色胶囊） ─────────────────────────────────────────
function SaveSuccessToast() {
  return (
    <div
      style={{
        position: "fixed",
        top: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        background: "#FFFFFF",
        border: "1.5px solid #34C759",
        borderRadius: "12px",
        padding: "12px 28px",
        boxShadow: "0 6px 22px rgba(52,199,89,0.18)",
        zIndex: 60,
        animation: "slideDown 0.25s ease",
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#34C759" />
        <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ fontSize: "15px", fontWeight: 600, color: "#2E7D32" }}>保存成功</span>
    </div>
  );
}

// ─── 离开守卫确认弹窗 ─────────────────────────────────────────────────────────
function ConfirmModal({ title, body, confirmLabel, onCancel, onConfirm }: {
  title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(40,28,12,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <div style={{ width: "480px", maxWidth: "92vw", background: "linear-gradient(180deg, #FFF8EF 0%, #FFF1E2 100%)", borderRadius: "18px", border: "1.5px solid #E1C2AD", boxShadow: "0 18px 60px rgba(150,95,25,0.22)", overflow: "hidden", animation: "modalIn 0.2s ease" }}>
        {/* 头 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "22px 26px 0" }}>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#17191C", letterSpacing: "0.08em" }}>{title}</span>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", color: "#929292", lineHeight: 1 }}>×</button>
        </div>
        {/* 正文 */}
        <p style={{ margin: "18px 26px 26px", fontSize: "16px", lineHeight: 1.75, color: "#17191C", fontWeight: 500 }}>{body}</p>
        {/* 底部两枚按钮 + 竖分隔 */}
        <div style={{ display: "flex", alignItems: "stretch", borderTop: "1px solid #E1C2AD" }}>
          <button onClick={onCancel} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 600, color: "#929292", padding: "16px 0" }}>取消</button>
          <div style={{ width: "1px", background: "#E1C2AD" }} />
          <button onClick={onConfirm} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 700, color: "#FF8400", padding: "16px 0" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ─── 双脚下载弹窗 ─────────────────────────────────────────────────────────────
function DualFootModal({ committed, onClose, onDownload, stlLeft, stlRight, deformLeft, deformRight, color, style, shoeSizeLeft, shoeSizeRight }: {
  committed: { left: FootState; right: FootState };
  onClose: () => void;
  onDownload: (fmt: "stl" | "glb") => void;
  stlLeft: StlInsoleParams;
  stlRight: StlInsoleParams;
  deformLeft: DeformMm;
  deformRight: DeformMm;
  color: string;
  style: InsoleStyle;
  shoeSizeLeft: number;
  shoeSizeRight: number;
}) {
  const tableRows: { label: string; left: string; right: string }[] = [
    { label: "鞋垫样式", left: STYLE_DEFS[style].label, right: STYLE_DEFS[style].label },
    { label: "匹配鞋码", left: `中国${shoeSizeLeft}码`, right: `中国${shoeSizeRight}码` },
    { label: "足弓矫正厚度", left: `+${committed.left.params.archCorrection}mm`, right: `+${committed.right.params.archCorrection}mm` },
    { label: "基础厚度", left: `${(committed.left.params.baseThickness * 10).toFixed(1)}mm`, right: `${(committed.right.params.baseThickness * 10).toFixed(1)}mm` },
    { label: "足跟缓冲厚度", left: `${committed.left.params.heelThickness}mm`, right: `${committed.right.params.heelThickness}mm` },
    { label: "鞋垫软硬", left: `${committed.left.hardness} Shore A`, right: `${committed.right.hardness} Shore A` },
  ];

  const cellBorder = "1px solid rgba(200,160,110,0.35)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(40,28,12,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ width: "960px", maxWidth: "94vw", height: "580px", maxHeight: "90vh", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 16px 60px rgba(120,70,10,0.28)", display: "flex", overflow: "hidden", animation: "modalIn 0.22s ease" }}>
        {/* 左：3D 预览（浅色底 + 淡网格） */}
        <div style={{ flex: 1, position: "relative", minWidth: 0, background: "#FCFAF6" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(180,150,110,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(180,150,110,0.06) 1px,transparent 1px)", backgroundSize: "28px 28px", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "20px", left: "24px", display: "flex", alignItems: "baseline", gap: "10px", zIndex: 2 }}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: C.dark }}>双脚3D鞋垫展示</span>
            <span style={{ fontSize: "12px", color: C.sub }}>3D Dual-Foot Insole View</span>
          </div>
          <StlInsoleViewer activeFoot="both" style={style} color={color} leftParams={stlLeft} rightParams={stlRight} leftDeform={deformLeft} rightDeform={deformRight} />
        </div>

        {/* 右：参数表 + 底部按钮 */}
        <div style={{ width: "420px", display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "20px 24px 12px" }}>
            <div style={{ fontSize: "16px", fontWeight: 700, color: C.dark }}>鞋垫参数 <span style={{ fontSize: "11px", color: C.sub, fontWeight: 400 }}>Dual-Foot Insole Parameters</span></div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", color: C.sub, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  {["类型", "左脚", "右脚"].map((h) => (
                    <th key={h} style={{ textAlign: "center", padding: "10px 6px", border: cellBorder, background: "rgba(245,166,35,0.1)", color: C.dark, fontWeight: 700 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.label}>
                    <td style={{ padding: "10px 8px", color: C.dark, fontWeight: 600, border: cellBorder }}>{r.label}</td>
                    <td style={{ padding: "10px 6px", textAlign: "center", fontWeight: 600, color: C.dark, fontFamily: "monospace", border: cellBorder }}>{r.left}</td>
                    <td style={{ padding: "10px 6px", textAlign: "center", fontWeight: 600, color: C.dark, fontFamily: "monospace", border: cellBorder }}>{r.right}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 底部：取消 + 下载文件 */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 24px", borderTop: `1px solid ${C.border}` }}>
            <button onClick={onClose} style={{ background: "#fff", border: `1.5px solid ${C.primary}`, borderRadius: "8px", height: "44px", padding: "0 26px", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: C.primaryDeep }}>取消</button>
            <button onClick={() => onDownload("stl")} style={{ flex: 1, background: C.primary, border: "none", borderRadius: "8px", height: "44px", cursor: "pointer", fontSize: "15px", fontWeight: 700, color: "#fff", boxShadow: "0 3px 10px rgba(245,166,35,0.3)" }}>下载文件</button>
          </div>
        </div>
      </div>
    </div>
  );
}
