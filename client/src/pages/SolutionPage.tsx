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
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useApp } from "@/contexts/AppContext";
import { formatUserId } from "@/lib/utils";
import { useDeviceConnectionStatus } from "@/hooks/useDeviceConnectionStatus";
// 解决方案页与报告页同一套浅色渐变背景（见下方 PageBg）
import { StlInsoleViewer, type StlInsoleParams } from "@/components/StlInsoleViewer";
import { STYLE_DEFS, productBaseHeightMm, personalDeform, ZERO_DEFORM, type InsoleStyle, type DeformMm } from "@/lib/insoleModel";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { apiSaveRecordSolution } from "@/lib/backendApi";
import {
  buildSolutionSnapshot,
  localStamp,
  restoreFoot,
  type SolutionSnapshot,
} from "@/lib/solutionSnapshot";
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
import BrandLogo from "@/components/BrandLogo";
import HistoryLink from "@/components/HistoryLink";

// ─── 配色 ─────────────────────────────────────────────────────────────────────
const C = {
  primary: "#00359F",
  primaryDeep: "#0A3997",
  dark: "#17191C",
  sub: "#929EAB",
  panel: "rgba(255,255,255,0.82)",
  border: "rgba(180,195,225,0.55)",
  insoleColor: "#ECECEC", // 默认灰白色（取自晶格鞋垫材质色）
};

/** 展会版只保留「标准」鞋垫：样式与颜色不再可选，快照里的旧样式/颜色一律忽略 */
const INSOLE_STYLE: InsoleStyle = "standard";

type Side = "left" | "right";
type Overlay = "main" | "drawer" | "download";

/**
 * 手填鞋垫尺寸的合理区间(cm)。输入框是自由 number，边打字边渲染会出现「2cm 的鞋垫」，
 * 区间外一律回退到测量分析值。上下限取成人足极值再放宽，不做业务校验、只挡明显笔误。
 */
const SIZE_MIN = { lenCm: 15, widCm: 5 } as const;
const SIZE_MAX = { lenCm: 35, widCm: 16 } as const;

/**
 * 取「生效尺寸」：手填值在区间内就用手填的，否则（空、半截数字、笔误）回退 fallback。
 * 厚度换算、鞋码匹配、脚型图标注、3D 预览、导出 STL 全都从这一个判定出发，
 * 否则会出现「图上标 27cm、3D 还是 26cm」这类自相矛盾。
 */
function pickSize(raw: string, fallback: number, min: number, max: number): number {
  const v = parseFloat(raw);
  return v >= min && v <= max ? v : fallback;
}

/** 成人男码。鞋码/足宽换算表见 insoleSize.ts，与「匹配鞋码：中国XX码」用同一套。 */
const SIZE_CATEGORY = "adult_male" as const;

/**
 * 成品垫的基础厚度 = 按鞋码算。
 * 足长先落到鞋码档（中国码 0.5cm 一档），再用该档的标称足长换原生高度——
 * 所以同一个码的垫子厚度唯一，26.1cm 和 26.3cm 都是 42 码、厚度相同。
 * 标准垫(param) 没有原生高度，回退压力自适应厚度。
 */
function baseThicknessCmForSize(style: InsoleStyle, footLengthCm: number, fallbackCm: number): number {
  const nominalLenCm = lookupInsoleSize(footLengthCm, SIZE_CATEGORY).footLengthCm;
  const mm = productBaseHeightMm(style, nominalLenCm);
  return mm != null ? mm / 10 : fallbackCm;
}

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

// ─── 页面背景：顶部淡蓝 → 向下渐白，与报告页同一套 ─────────────────────────────
function PageBg() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "linear-gradient(180deg, #EEF4FF 0%, #FFFFFF 57.5%, #FFFFFF 100%)",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

// ─── 通用子组件 ───────────────────────────────────────────────────────────────
// tip 给了才画 ⓘ —— 原来是个光秃秃的 info 布尔，图标画得出来但鼠标移上去没反应
function SectionTitle({ zh, en, right, tip }: { zh: string; en: string; right?: React.ReactNode; tip?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "16px", fontWeight: 800, color: "#17191C", letterSpacing: "0.02em" }}>{zh}</span>
        <span style={{ fontSize: "12px", color: "#6C7FA4", fontWeight: 500 }}>{en}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      {right}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  // 纵向 flex：三卡等高后，卡内 flex:1 的正文区把标题以下的高度全部吃掉，不留空白
  return (
    <div style={{ background: "#FFFFFF", borderRadius: "16px", padding: "14px 18px", boxShadow: "0 6px 22px rgba(26,58,122,0.10)", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {children}
    </div>
  );
}

/** 卡片正文：吃掉标题以下全部高度，子项按纵向 flex 排布 */
function CardBody({ children, gap = 0, row = false }: { children: React.ReactNode; gap?: number; row?: boolean }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: row ? "row" : "column", gap: `${gap}px` }}>
      {children}
    </div>
  );
}

// ⓘ 信息图标（透明度交给外层 InfoTip 控制，避免与 hover 态相乘）
function InfoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, display: "block" }}>
      <circle cx="8" cy="8" r="7" stroke="#586E9A" strokeWidth="1.2" />
      <circle cx="8" cy="4.6" r="0.9" fill="#586E9A" />
      <rect x="7.2" y="6.6" width="1.6" height="5" rx="0.8" fill="#586E9A" />
    </svg>
  );
}

/**
 * 参数说明文案：讲「调它会发生什么」，不是重复标题。
 * 数值区间与推荐值都取自实际算法（insoleLogic 的分级/硬度表、baseThicknessCmForSize 的鞋码换算），
 * 别在这儿另写一套，否则文案和滑块能调到的范围会对不上。
 */
/**
 * 参数说明文案：一律讲这个值「依据什么定出来的」，不写「调大支撑更强」那类话
 * —— 这几项都是按测量结果算出来的，越大越好的暗示是错的。
 *
 * 文案沿用旧项目 foot-pressure-report（做新 UI 时整块丢掉了）：
 *  - archCorrection / base 取自那边的 PARAMETER_EXPLANATIONS，base 后半句换成「由鞋码换算得到」
 *  - arch 取自那边「足弓分级参考」面板表格下方那句 ⓘ 说明
 *  - heel 同样出自 PARAMETER_EXPLANATIONS，原文 80 字，压到与 archCorrection 相当的长度
 *  - hardness 那边没有，按同一句式新写；依据是 getZoneHardness/getInsoleHardness 的三区取平均
 *
 * 卡标题「鞋垫厚度」与抽屉小节「软硬调节」不挂说明：它们是分组标题而非参数，
 * 该讲的都在下面各行里，标题上再挂一枚只是重复。
 */
const TIP = {
  arch: "足弓指数（AI）是基于静态足印面积计算的经典指标，至今仍是判断高足弓与扁平足的金标准。",
  archCorrection: "依据舟骨下降理论，结合舒适度修正系数，并参考用户足弓高度计算得到，用于在支撑效果与穿着舒适度之间取得平衡。",
  base: "依据传感器材料特性与穿着舒适度设定，并由鞋码换算得到，是鞋垫整体支撑与缓冲的基础参数。",
  baseAdaptive: "依据传感器材料特性与穿着舒适度设定，并按左右脚压力占比分配，是鞋垫整体支撑与缓冲的基础参数。",
  heel: "以 10mm 为基础值，参考足跟脂肪垫平均压缩量设定；足型越偏离正常，给予的后跟缓冲通常越多。",
  hardness: "依据足弓等级对应的前掌、足弓、后跟三区推荐硬度取平均得到，用于在吸震缓冲与支撑回弹之间取得平衡。",
} as const;

/**
 * ⓘ + 悬停说明。走项目里那套 radix Tooltip（App.tsx 已挂 TooltipProvider，delayDuration=0 即时弹出）。
 * 用它而不是自己画气泡的原因：内容走 portal 渲染，不会被抽屉的 overflow 或右侧面板裁掉。
 * z-index 显式压过抽屉(40)和顶栏(100)，否则靠上/靠下的几条会被盖住。
 */
function InfoTip({ text, size = 14 }: { text: string; size?: number }) {
  const [hover, setHover] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            flexShrink: 0,
            cursor: "help",
            opacity: hover ? 1 : 0.55,
            transition: "opacity 0.15s",
          }}
        >
          <InfoIcon size={size} />
        </span>
      </TooltipTrigger>
      {/* textWrap 显式改回 wrap：气泡默认带 text-balance，会把每行均摊成等长短行，
          配上固定宽度就成了「文字挤在左边、右边空一条」。宽度写死 260 让多行左右对齐。 */}
      <TooltipContent
        side="top"
        sideOffset={6}
        className="leading-relaxed"
        style={{ zIndex: 200, width: 260, textWrap: "wrap", textAlign: "justify" }}
      >
        {text}
      </TooltipContent>
    </Tooltip>
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

/**
 * 足弓状态卡的中性配色（对齐设计稿 image.png）。
 * 此前解读框/建议框走的是页面那套暖褐色（#EFF2F7 / #E1EAFB + 褐字），
 * 与光谱条的红黄绿放在一起互相抢；改成中性浅灰底 + 白底建议框 + 深灰正文，
 * 颜色只留给光谱条与等级本身。
 */
const ARCH_C = {
  readBg: "#F7F7F8",
  readBorder: "#EDEDEE",
  text: "#3D3D3D",
  sugBg: "#FFFFFF",
  sugBorder: "#E6E6E7",
};

function ArchSpectrum({ params, sideLabel }: { params: InsoleParams; sideLabel: string }) {
  const level = params.archLevel; // 1-7
  const levelColor = getArchLevelColor(level);
  // 三角标记定位在第 level 段中心
  const markerPct = ((level - 0.5) / 7) * 100;
  const baseMm = (params.baseThickness * 10).toFixed(1);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 渐变光谱条 + 下三角标记。7 段紧挨、整条统一圆角（设计稿是一条连续色带，段间无白缝） */}
      <div style={{ position: "relative", marginTop: "14px", marginBottom: "6px" }}>
        {/* 三角标记 */}
        <div style={{ position: "absolute", top: "-11px", left: `${markerPct}%`, transform: "translateX(-50%)" }}>
          <div style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: `8px solid ${levelColor}` }} />
        </div>
        <div style={{ display: "flex", height: "12px", borderRadius: "6px", overflow: "hidden" }}>
          {[1, 2, 3, 4, 5, 6, 7].map((l) => (
            <div key={l} style={{ flex: 1, background: getArchLevelColor(l) }} />
          ))}
        </div>
      </div>
      {/* 7 标签：各自染成所属等级的颜色，当前等级加粗 */}
      <div style={{ display: "flex", marginBottom: "10px" }}>
        {ARCH_LABELS.map((t, i) => (
          <span key={t} style={{ flex: 1, textAlign: "center", fontSize: "10px", color: getArchLevelColor(i + 1), fontWeight: i === level - 1 ? 700 : 500 }}>{t}</span>
        ))}
      </div>
      {/* 解读框：吃掉光谱条以下的剩余高度，三段内容在框内均匀铺开 */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "space-evenly", background: ARCH_C.readBg, border: `1px solid ${ARCH_C.readBorder}`, borderRadius: "10px", padding: "10px 14px" }}>
        <p style={{ margin: "0 0 5px", fontSize: "12px", color: ARCH_C.text, lineHeight: 1.6 }}>
          详细解读：{sideLabel}脚足弓状态处于足弓分级中的 L{level} 等级
          <span style={{ color: levelColor, fontWeight: 700 }}>{params.archType}</span>；
        </p>
        <p style={{ margin: "0 0 5px", fontSize: "12px", color: ARCH_C.text, lineHeight: 1.6 }}>
          {getArchDesignLogic(level)}。
        </p>
        <div style={{ background: ARCH_C.sugBg, border: `1px solid ${ARCH_C.sugBorder}`, borderRadius: "8px", padding: "8px 12px", fontSize: "12px", color: ARCH_C.text, textAlign: "center", lineHeight: 1.5 }}>
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
  const ORANGE = "#1C54C5";
  const FADED = "#C3D0EA";
  // 宽度标注线覆盖聚焦（橙色）那只鞋垫的前掌
  const wx1 = leftFocused ? 26 : 78;
  const wx2 = leftFocused ? 69 : 121;
  const wmid = (wx1 + wx2) / 2;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "185px" }}>
      <svg viewBox="0 0 135 152" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} preserveAspectRatio="xMidYMid meet">
        {/* 长度标注线（左侧，贯穿全高） */}
        <line x1="15" y1="16" x2="15" y2="140" stroke="#6A8AC9" strokeWidth="1.1" />
        <line x1="11.5" y1="16" x2="18.5" y2="16" stroke="#6A8AC9" strokeWidth="1.1" />
        <line x1="11.5" y1="140" x2="18.5" y2="140" stroke="#6A8AC9" strokeWidth="1.1" />
        <text x="7" y="78" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#28437A" transform="rotate(-90 7 78)">{lengthCm} cm</text>
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
        <line x1={wx1} y1="11" x2={wx2} y2="11" stroke="#0C3EA1" strokeWidth="1.1" />
        <line x1={wx1} y1="7.5" x2={wx1} y2="14.5" stroke="#0C3EA1" strokeWidth="1.1" />
        <line x1={wx2} y1="7.5" x2={wx2} y2="14.5" stroke="#0C3EA1" strokeWidth="1.1" />
        <text x={wmid} y="6" textAnchor="middle" fontSize="8.5" fontWeight="600" fill="#28437A">{widthCm} cm</text>
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
  tip,
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
  tip?: string;
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
  // 填充的两端要贴到轨道真实边缘。圆钮是内缩定位的（0% 落在 9px 处），
  // 填充照抄 posX 的话最左/最右各有 9px（半个圆钮）永远不着色 ——
  // 把滑块拉到最小值时那截浅色轨道就露在最左边，看着像「拉到 0 了最左侧还有空余」。
  // 端点用 0 而不是 posX(0)/posX(100)，中间值仍对齐圆钮圆心。
  const fillLeftCss = fillStart <= 0.001 ? "0px" : posX(fillStart);
  const fillRightCss = fillEnd >= 99.999 ? "0px" : `calc(100% - (${posX(fillEnd)}))`;
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
        background: "#E4E9F4",
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: C.dark, fontWeight: 500 }}>
          {label}
          {tip && <InfoTip text={tip} size={13} />}
        </span>
        <span style={{ fontSize: "13px", fontWeight: 700, color: C.primaryDeep, fontFamily: "monospace", background: "rgba(7,59,163,0.12)", padding: "2px 8px", borderRadius: "6px" }}>
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
          <div style={{ position: "absolute", inset: 0, borderRadius: "10px", background: "rgba(168,185,219,0.30)" }} />
          {/* 填充：以 0 为锚点，正值橙色向右、负值蓝色向左 */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: fillLeftCss, right: fillRightCss, borderRadius: "10px", background: fillColor }} />
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
          <div style={{ position: "absolute", left: posX(valuePct), top: "50%", transform: "translate(-50%,-50%)", width: `${KN}px`, height: `${KN}px`, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(21,48,104,0.28)", pointerEvents: "none" }} />
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
    <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#fff", borderRadius: "16px", padding: "5px 12px", boxShadow: "0 1px 6px rgba(26,56,117,0.12)" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M9 12h6M8 9a3 3 0 0 0 0 6h2M16 9a3 3 0 0 1 0 6h-2" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: "12px", color, fontWeight: 600 }}>{connected ? "设备连接正常" : "设备未连接"}</span>
    </div>
  );
}

// ─── 底部操作栏（与报告页底栏同一套：高度 / 字重 / 配色 / 下划线 / 5 位 ID） ────────
function BottomBar({ userName, userId, onBack, onRestart, onDownload, downloadReady }: {
  userName: string; userId: string; onBack?: () => void; onRestart: () => void; onDownload: () => void;
  /** 鞋垫长宽是否已填齐。未填齐时按钮置灰，但仍可点——点了给出「缺什么」的提示，比死按钮好懂 */
  downloadReady: boolean;
}) {
  const linkBtn: React.CSSProperties = {
    background: "none", border: "none", cursor: "pointer",
    fontSize: "14px", fontWeight: 700,
    textDecoration: "underline", textUnderlineOffset: "4px",
  };
  return (
    <div style={{ height: "56px", display: "flex", alignItems: "center", gap: "28px" }}>
      <DeviceBadge />
      <span style={{ fontSize: "14px", fontWeight: 700, color: "#3d3d3d", marginLeft: "auto" }}>当前用户：{userName}（ID:{userId}）</span>
      <button onClick={onBack} style={{ ...linkBtn, color: "#3d3d3d" }}>重新测量</button>
      <button onClick={onRestart} style={{ ...linkBtn, color: "#00359f" }}>结束体验</button>
      {/* 未填齐尺寸时置灰、去下划线，与报告页的占位态同款；填齐后是品牌蓝可点链接 */}
      <button
        onClick={onDownload}
        title={downloadReady ? undefined : "请先填写左右脚鞋垫长度和宽度"}
        style={downloadReady
          ? { ...linkBtn, color: "#00359f" }
          : { ...linkBtn, color: "#a6afc0", textDecoration: "none", cursor: "not-allowed" }}
      >
        下载文件
      </button>
    </div>
  );
}

// ─── 厚度三条（抽屉/细节复用） ────────────────────────────────────────────────
// drawerMode：抽屉（第2页）里前两项无滑块，仅步进；细节面板（第3页）三项均带滑块。
function ThicknessSliders({ fs, sys, onParams, drawerMode, style }: { fs: FootState; sys?: FootState; onParams: (p: Partial<InsoleParams>) => void; drawerMode?: boolean; style: InsoleStyle }) {
  // 成品垫(proportional)：基础厚度默认=原生高度按鞋码换算(约 50~57mm，见 baseThicknessCmForSize)，
  // 量程较大；调节方式与标准垫一致——抽屉里只给 −/+ 步进，不出滑块。
  const proportional = STYLE_DEFS[style].heightMode === "proportional";
  return (
    <>
      {proportional ? (
        <StepperSliderRow
          label="基础厚度（随鞋码）"
          tip={TIP.base}
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
          tip={TIP.baseAdaptive}
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
        tip={TIP.archCorrection}
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
        tip={TIP.heel}
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
function ThickPillRow({ label, value, adjusted, tip }: { label: string; value: string; adjusted?: boolean; tip?: string }) {
  // flex:1：三条胶囊平分卡片正文高度（行距由父级 gap 给），卡片多高胶囊就多高
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#E7EFFF", borderRadius: "12px", padding: "10px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#17191C" }}>{label}</span>
        {tip && <InfoTip text={tip} size={13} />}
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
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
      <span style={{ fontSize: "14px", fontWeight: 600, color: "#17191C", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
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

// ─── 自定义顶栏（左白右橙 + 步骤） ────────────────────────────────────────────
// 设备连接徽章只留底部操作栏那一枚：顶栏右上角原本还有一枚，同一页两处同样的标识，
// 状态一致时纯属重复、不一致时更让人怀疑哪个是真的。
/** 顶栏：左品牌标识 + 右「体验记录」入口（与采集/报告页一致），不再显示步骤导航。
 *  absolute 而非 fixed：矮屏整页滚动时随内容滚走，不会透明地压在滚上来的标题/左右脚按钮上 */
function SolutionTopBar({ onHistory }: { onHistory?: () => void }) {
  return (
    <header style={{ position: "absolute", top: 0, left: 0, right: 0, height: "var(--sol-topbar-h, 72px)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--sol-pad-x, 40px)", zIndex: 100 }}>
      <BrandLogo size={52} />
      <HistoryLink onClick={onHistory} />
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
  const { currentUser, analysis, selectedRecord, selectedSolution, setSelectedSolution } = useApp();

  // 历史回看时读回的方案快照（UserRecordsPage 在跳转前已放进 context）。
  // 存进 ref：只在挂载那一刻取一次，之后无论 context 怎么变都不再二次套用。
  const snapshotRef = useRef(selectedSolution);

  const [side, setSide] = useState<Side>("left");
  const [overlay, setOverlay] = useState<Overlay>("main");


  /**
   * 用户真的动过手（颜色 / 样式 / 尺寸 / 换鞋壳 / 抽屉保存）→ 此后任何状态变化都自动落盘。
   * 定义在这么前面是因为下面几个 useCallback 的依赖数组要用它（引用早于定义会踩 TDZ）。
   */
  const solutionDirty = useRef(false);
  const markSolutionEdited = useCallback(() => {
    solutionDirty.current = true;
  }, []);


  // 已提交参数 / 加载默认值 / 编辑草稿
  const [committed, setCommitted] = useState<{ left: FootState; right: FootState } | null>(null);
  const [defaults, setDefaults] = useState<{ left: FootState; right: FootState } | null>(null);
  const [draft, setDraft] = useState<{ left: FootState; right: FootState } | null>(null);
  // 分析原始值（base 为压力自适应厚度）；成品垫的基础厚度按样式另行换算，此处保留标准垫回退用
  const [analysisBase, setAnalysisBase] = useState<{ left: FootState; right: FootState } | null>(null);

  // 保存成功提示（顶部居中绿色胶囊）
  const [savedTip, setSavedTip] = useState(false);
  // 离开守卫弹窗
  const [confirm, setConfirm] = useState<null | "remeasure" | "remeasureSaved" | "finish" | "finishSaved">(null);
  // 用户手填的鞋垫尺寸（默认置空，用于校验；不回写测量参数）
  const [insoleSize, setInsoleSize] = useState<{ left: { length: string; width: string }; right: { length: string; width: string } }>(
    // 有快照就还原当时手填的四个尺寸（它们决定鞋码档 → 厚度基准，必须早于下面的基准 effect 就位）
    () => snapshotRef.current?.insoleSize ?? { left: { length: "", width: "" }, right: { length: "", width: "" } },
  );

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
      // 换人/换历史记录 = 换一套厚度基准，下面那个 effect 要按绝对值重新落一次
      baselineRef.current = null;
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

  // 生效足长：手填鞋垫长度优先，没填才用测量值。厚度基准、鞋码、3D、导出都由它派生。
  // 写成两个标量而不是对象，是为了能直接当下面 effect 的依赖（对象每次渲染都是新引用）。
  const effLenLeft = pickSize(insoleSize.left.length, analysisBase?.left.params.footLength ?? NaN, SIZE_MIN.lenCm, SIZE_MAX.lenCm);
  const effLenRight = pickSize(insoleSize.right.length, analysisBase?.right.params.footLength ?? NaN, SIZE_MIN.lenCm, SIZE_MAX.lenCm);

  /** 上一次落下的厚度基准（cm）。用来把用户手动加的量平移到新基准上，null = 按绝对值落。 */
  const baselineRef = useRef<{ left: number; right: number } | null>(null);

  // 基础厚度 = 「按鞋码算出的基准」+「用户手动加的量」。
  // 鞋码或样式一变就重算基准：卡片、抽屉、3D、导出的数一起刷新，不会停在旧尺码上；
  // 同时用平移而不是覆盖——切换舒缓/运动/标准不再把用户手动调的厚度清零。
  useEffect(() => {
    if (!analysisBase) return;
    const next = {
      left: baseThicknessCmForSize(INSOLE_STYLE, effLenLeft, analysisBase.left.params.baseThickness),
      right: baseThicknessCmForSize(INSOLE_STYLE, effLenRight, analysisBase.right.params.baseThickness),
    };
    const prevBase = baselineRef.current;
    // 同一鞋码档内改足长（26.1→26.3 都是 42 码）基准不变，不必重设状态
    if (prevBase && prevBase.left === next.left && prevBase.right === next.right) return;
    baselineRef.current = next;

    const shift = (fs: FootState, s: Side): FootState => ({
      ...fs,
      params: { ...fs.params, baseThickness: prevBase ? fs.params.baseThickness + (next[s] - prevBase[s]) : next[s] },
    });
    const keepDelta = (prev: { left: FootState; right: FootState } | null) =>
      prev ? { left: shift(prev.left, "left"), right: shift(prev.right, "right") } : prev;
    // defaults 是「系统推荐值」，永远等于纯基准（抽屉里那条灰线、以及「已调整」的判据）
    const toBaseline = (prev: { left: FootState; right: FootState } | null) =>
      prev
        ? {
            left: { ...prev.left, params: { ...prev.left.params, baseThickness: next.left } },
            right: { ...prev.right, params: { ...prev.right.params, baseThickness: next.right } },
          }
        : prev;

    setCommitted(keepDelta);
    setDefaults(toBaseline);
    setDraft(keepDelta);
  }, [analysisBase, effLenLeft, effLenRight]);

  /**
   * 历史回看：把快照里的参数盖回 committed。
   * 必须等上面那个厚度基准 effect 落定（baselineRef 已有值）才动手，否则会被它当场平移掉；
   * restoredRef 保证只套一次 —— 之后用户改什么都不会被快照回滚。
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    const snap = snapshotRef.current;
    const baseline = baselineRef.current;
    if (!snap || restoredRef.current || !defaults || !baseline) return;
    restoredRef.current = true;
    // 基础厚度取「当次算出的基准 + 快照里的增量」，所以之后换样式/换鞋码增量依旧跟着走。
    // 基准只能读 baselineRef —— 挂载时上面那个基准 effect 与本 effect 在同一批里跑完，
    // 此刻闭包里的 defaults 还是分析原始值（压力自适应 3.0mm），拿它当基准会把成品垫的
    // 54.5mm 还原成 3.0mm，还顺带在「基础厚度」上挂个假的「已调整」。ref 永远是最新的。
    setCommitted({
      left: restoreFoot(snap.feet.left, baseline.left),
      right: restoreFoot(snap.feet.right, baseline.right),
    });
    setDraft(null);
    // 这里不弹 toast：历史回看本来就该直接呈现当时的参数，参数是否被调过卡上已有「已调整」角标，
    // 再来一句「已载入…」只是重复，且每次进页面都弹。
  }, [defaults]);

  /**
   * 把当前方案参数存回这条采集记录（历史记录行的「方案更新时间 / 已编辑」由它产生）。
   * 没有 record（后端挂了、演示数据）就静默跳过 —— 用户没做错什么，不该看到报错。
   *
   * 所有写盘都过 solutionPending + flushSolution 这一个口子：排队中的那次会被后来的顶掉，
   * 显式动作（抽屉保存 / 重新测量 / 结束体验 / 导出）立刻发，自动保存合并 800ms 再发。
   */
  const solutionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solutionPending = useRef<{ rid: number; snap: SolutionSnapshot } | null>(null);

  const flushSolution = useCallback(() => {
    if (solutionSaveTimer.current) {
      clearTimeout(solutionSaveTimer.current);
      solutionSaveTimer.current = null;
    }
    const p = solutionPending.current;
    solutionPending.current = null;
    if (!p) return;
    // 同步进 context：本次会话里再从报告页/步骤条回到本页时，快照只有 UserRecordsPage 点行那一次
    // 会去后端取。不同步的话「改完 → 返回分析报告 → 查看解决方案」会拿着旧的 null 走默认值，
    // 盘上明明存着也白存（实测记录 16 就是这样：DB 里已是 sport 26/11，页面还显示舒缓 + 空尺寸）。
    setSelectedSolution(p.snap);
    apiSaveRecordSolution(p.rid, p.snap, localStamp()).catch((err) =>
      console.warn("[solution] 方案快照保存失败（后端不可用？）:", err),
    );
  }, [setSelectedSolution]);

  /**
   * 打一份当前状态的快照。显式存点与自动保存共用这一个入口 ——
   * 两处各拼一遍参数表的话，往快照里加字段（如这轮的鞋壳视图/摆位）必然漏一处。
   */
  const makeSnapshot = useCallback(
    (cm: { left: FootState; right: FootState }, df: { left: FootState; right: FootState }) =>
      buildSolutionSnapshot({
        insoleStyle: INSOLE_STYLE,
        insoleColor: C.insoleColor,
        insoleSize,
        committed: cm,
        defaults: df,
      }),
    [insoleSize],
  );

  const persistSolution = useCallback(
    (overrideCommitted?: { left: FootState; right: FootState } | null) => {
      const rid = selectedRecord?.id;
      const cm = overrideCommitted ?? committed;
      if (rid == null || !cm || !defaults) return;
      solutionPending.current = { rid, snap: makeSnapshot(cm, defaults) };
      flushSolution();
    },
    [selectedRecord?.id, committed, defaults, makeSnapshot, flushSolution],
  );

  /**
   * 自动保存 —— 改完从「返回分析报告」/ 顶部步骤条 / 历史用户离开是常态，
   * 光靠那几个显式存点必丢：实测在记录 16 上把样式改成运动、尺寸填 26/11，
   * 点「返回分析报告」再回来，全部回到推荐值，期间一个请求都没发出去过。
   *
   * 「改过没有」靠 solutionDirty 由真实用户动作打标，不用状态 diff —— 挂载那几帧里
   * 厚度基准与历史快照还原会连着改 committed，diff 法会把「只看不改」也算成编辑，
   * 让历史记录行无端冒出「方案更新时间 / 已编辑」。
   */
  useEffect(() => {
    if (!solutionDirty.current) return;
    const rid = selectedRecord?.id;
    if (rid == null || !committed || !defaults) return;
    solutionPending.current = { rid, snap: makeSnapshot(committed, defaults) };
    // 合并连续操作（尺寸一位一位地敲、连点几个颜色、拖透明度滑杆），也顺带等厚度基准那个 effect 落定
    if (solutionSaveTimer.current) clearTimeout(solutionSaveTimer.current);
    solutionSaveTimer.current = setTimeout(flushSolution, 800);
  }, [committed, defaults, makeSnapshot, selectedRecord?.id, flushSolution]);

  // 离开页面时把还在排队的那次补发：切走（卸载）走 cleanup，关标签/刷新走 pagehide
  useEffect(() => {
    const onLeave = () => flushSolution();
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      flushSolution();
    };
  }, [flushSolution]);

  // 编辑期用 draft，否则用 committed
  const editing = overlay === "drawer";
  const viewState = editing && draft ? draft : committed;

  /**
   * 把用户手填的「鞋垫长度/宽度」叠加到某只脚上 —— 3D 预览与导出 STL 的统一入口。
   * 手填值是唯一真源：填了就按填的走，没填（或还在打字、数值离谱）才回退测量分析值。
   *
   * 基础厚度按同一条公式（baseThicknessCmForSize + 用户增量）再算一遍。上面的 effect 已经把
   * 结果写进了 committed/draft，所以稳定后这里算出来的就是原值、幂等；它只兜住「刚敲完新尺码、
   * effect 还没落地」那一帧——否则那一帧会用旧鞋码的厚度配新足长，垫子闪一下高度。
   *
   * 厚度卡片与调节抽屉读的是状态里的值，此函数的结果只进几何、不回写状态，不存在二次叠加。
   */
  const sizedFoot = useCallback(
    (s: Side, fs: FootState): FootState => {
      const len = pickSize(insoleSize[s].length, fs.params.footLength, SIZE_MIN.lenCm, SIZE_MAX.lenCm);
      const wid = pickSize(insoleSize[s].width, fs.params.footWidth, SIZE_MIN.widCm, SIZE_MAX.widCm);
      if (len === fs.params.footLength && wid === fs.params.footWidth) return fs;

      const sysBaseCm = defaults?.[s].params.baseThickness;
      const baseThickness =
        sysBaseCm != null
          ? baseThicknessCmForSize(INSOLE_STYLE, len, fs.params.baseThickness) + (fs.params.baseThickness - sysBaseCm)
          : fs.params.baseThickness;

      return { ...fs, params: { ...fs.params, footLength: len, footWidth: wid, baseThickness } };
    },
    [insoleSize, defaults],
  );

  const stlLeft = useMemo<StlInsoleParams | null>(() => (viewState ? toStlParams(sizedFoot("left", viewState.left)) : null), [viewState, sizedFoot]);
  const stlRight = useMemo<StlInsoleParams | null>(() => (viewState ? toStlParams(sizedFoot("right", viewState.right)) : null), [viewState, sizedFoot]);
  const deformLeft = useMemo<DeformMm>(() => (viewState ? toDeform(sizedFoot("left", viewState.left), INSOLE_STYLE) : ZERO_DEFORM), [viewState, sizedFoot]);
  const deformRight = useMemo<DeformMm>(() => (viewState ? toDeform(sizedFoot("right", viewState.right), INSOLE_STYLE) : ZERO_DEFORM), [viewState, sizedFoot]);

  if (!committed || !viewState || !stlLeft || !stlRight) {
    return (
      <div style={{ minHeight: "100vh", position: "relative", overflow: "hidden", fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",Arial,sans-serif' }}>
        <PageBg />
        <SolutionTopBar onHistory={onHistory} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: "14px" }}>
          正在生成解决方案…
        </div>
      </div>
    );
  }

  const cur = viewState[side];
  const sideLabel = side === "left" ? "左" : "右";

  // 匹配鞋码：用户已填鞋垫长度→按输入换算；未填→用分析报告结果。
  // 这个码就是基础厚度的换算依据（baseThicknessCmForSize），显示的码与厚度必然对得上。
  const shoeSizeFor = (s: Side) => {
    const len = parseFloat(insoleSize[s].length);
    if (len >= SIZE_MIN.lenCm && len <= SIZE_MAX.lenCm) return lookupInsoleSize(len, SIZE_CATEGORY).shoeSize;
    return committed[s].shoeSize;
  };

  // 脚型图的长/宽标注：用户填了输入就用输入值（随输入实时变化），未填则回退分析值。
  // 生效区间与 sizedFoot 一致——否则会出现「图上标 2cm、3D 却还是 26cm」这种自相矛盾。
  const dimFor = (s: Side) => ({
    lengthCm: pickSize(insoleSize[s].length, Math.round(committed[s].params.footLength), SIZE_MIN.lenCm, SIZE_MAX.lenCm),
    widthCm: pickSize(insoleSize[s].width, Math.round(committed[s].params.footWidth), SIZE_MIN.widCm, SIZE_MAX.widCm),
  });

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
    markSolutionEdited();
    if (draft) setCommitted(draft);
    // 传 draft 进去：setCommitted 是异步的，此刻的 committed 还是旧值
    persistSolution(draft);
    setDraft(null);
    setOverlay("main");
    setSavedTip(true);
    setTimeout(() => setSavedTip(false), 2000);
  };
  const cancelDraft = () => { setDraft(null); setOverlay("main"); };

  // ── 离开守卫 / 下载闸门：鞋垫尺寸四项是否都填了、且都在合理区间内 ──
  // 只判「非空」不够：填个 2cm 会被 pickSize 静默回退成测量值，页面显示 26cm、
  // 用户以为自己填过了，导出的却不是他填的那双。区间判据与 pickSize 保持同一套。
  const sizeOk = (raw: string, min: number, max: number) => {
    const v = parseFloat(raw);
    return raw.trim() !== "" && v >= min && v <= max;
  };
  const sizesFilled =
    sizeOk(insoleSize.left.length, SIZE_MIN.lenCm, SIZE_MAX.lenCm) &&
    sizeOk(insoleSize.left.width, SIZE_MIN.widCm, SIZE_MAX.widCm) &&
    sizeOk(insoleSize.right.length, SIZE_MIN.lenCm, SIZE_MAX.lenCm) &&
    sizeOk(insoleSize.right.width, SIZE_MIN.widCm, SIZE_MAX.widCm);
  // 离场即存：几个弹窗的文案都承诺了「自动保存到历史记录」，尺寸填没填都要存
  // 重新测量、结束体验都一律先弹窗告知（尺寸已填 → 告知已保存；未填 → 提醒尺寸缺失），
  // 不再有「填完了就直接跳走、什么都不说」这一路 —— 调完参数点重新测量最容易让人以为白改了。
  const handleRemeasure = () => { persistSolution(); setConfirm(sizesFilled ? "remeasureSaved" : "remeasure"); };
  const handleFinish = () => { persistSolution(); setConfirm(sizesFilled ? "finishSaved" : "finish"); };

  // 未填齐鞋垫长宽不允许下载：尺寸决定几何，缺了就是照测量值导出，
  // 拿到手的打印件和用户以为的那双对不上。挡在打开弹窗之前，并说清缺什么。
  const guardSizes = () => {
    if (sizesFilled) return true;
    toast.error("请先填写左右脚的鞋垫长度和宽度", {
      description: `两只脚共四项都要填（长 ${SIZE_MIN.lenCm}~${SIZE_MAX.lenCm}cm，宽 ${SIZE_MIN.widCm}~${SIZE_MAX.widCm}cm），填完才能下载文件`,
    });
    return false;
  };

  // ── STL 下载 ──
  const handleDownload = async (fmt: "stl" | "glb") => {
    if (!guardSizes()) return;
    const name = currentUser?.name;
    try {
      toast.info(`正在生成 ${fmt.toUpperCase()} 文件，请稍候…`);
      const exporter = fmt === "stl" ? exportStlInsoleSTL : exportStlInsoleGLTF;
      for (const f of ["left", "right"] as const) {
        // 与 3D 预览同一条 sizedFoot 通道：手填尺寸必须进导出，否则所见非所打印
        const s = sizedFoot(f, committed[f]);
        const d = toDeform(s, INSOLE_STYLE);
        await exporter(INSOLE_STYLE, f, s.params.footLength, s.params.footWidth, s.params.archCorrection, s.params.baseThickness, s.params.heelThickness, C.insoleColor, name, d);
      }
      toast.success(`双脚鞋垫 ${fmt.toUpperCase()} 文件已开始下载`, { description: "可直接用于 3D 打印" });
      persistSolution(); // 导出过的参数一定要留痕，否则回头对不上手里那份打印件
    } catch (err) {
      console.error(err);
      toast.error("文件导出失败，请重试");
    }
  };

  return (
    <div className="sol-shell">
      <PageBg />
      <SolutionTopBar onHistory={onHistory} />

      <main className="sol-main">
        {/* 上：3D 晶格鞋垫（仅标准垫）。舞台高度与采集/报告页脚模区同一公式 */}
        <section className="sol-stage">
          <div className="sol-stage-head">
            <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1A2F5A" }}>{sideLabel}脚鞋垫展示</h2>
            <div style={{ display: "flex", gap: "6px", background: "rgba(255,255,255,0.6)", padding: "4px", borderRadius: "10px" }}>
              {(["left", "right"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    height: "30px", padding: "0 18px", borderRadius: "8px", border: "none", cursor: "pointer",
                    fontSize: "13px", fontWeight: 600,
                    color: side === s ? "#fff" : "#99A1B2",
                    background: side === s ? C.primary : "#DCE2ED",
                    transition: "all 0.18s",
                  }}
                >
                  {s === "left" ? "左脚鞋垫" : "右脚鞋垫"}
                </button>
              ))}
            </div>
          </div>
          <div className="sol-viewer">
            <StlInsoleViewer
              activeFoot={side}
              style={INSOLE_STYLE}
              color={C.insoleColor}
              leftParams={stlLeft}
              rightParams={stlRight}
              leftDeform={deformLeft}
              rightDeform={deformRight}
              defaultHeatmap
            />
          </div>
        </section>

        {/* 下：方案参数面板（三卡横排） */}
        <section className="sol-panel">
          <div className="sol-panel-head">
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#17191C" }}>{sideLabel}脚解决方案</span>
            <button
              onClick={onViewReport}
              style={{ height: "34px", padding: "0 16px", borderRadius: "10px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#fff", background: C.primary, display: "inline-flex", alignItems: "center", gap: "6px", boxShadow: "0 3px 10px rgba(7,59,163,0.3)" }}
            >
              返回分析报告 ›
            </button>
          </div>

          <div className="sol-grid">
            {/* 足弓状态 */}
            <Card>
              <SectionTitle zh="足弓状态" en="Foot arch status" tip={TIP.arch} />
              <CardBody>
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
                <ArchSpectrum params={committed[side].params} sideLabel={sideLabel} />
              </CardBody>
            </Card>

            {/* 鞋垫尺寸 */}
            <Card>
              <SectionTitle zh="鞋垫尺寸" en="Foot dimensions" />
              <CardBody row gap={14}>
                {/* 脚型图：随正文高度撑满（SVG meet 等比缩放）；窄屏让位给右侧输入区，避免「左鞋垫长度」折行 */}
                <div style={{ flex: "0 0 clamp(108px, 9.4vw, 150px)", display: "flex" }}>
                  <FootPair lengthCm={dimFor(side).lengthCm} widthCm={dimFor(side).widthCm} side={side} />
                </div>
                {/* 输入区：输入框盒子吃掉剩余高度，两行输入在盒内均匀铺开；鞋码盒贴底 */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ flex: 1, background: "#E7EFFF", borderRadius: "12px", padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-evenly", gap: "10px" }}>
                    <SizeInputRow label={`${sideLabel}鞋垫长度`} value={insoleSize[side].length} onChange={(v) => { markSolutionEdited(); setInsoleSize((s) => ({ ...s, [side]: { ...s[side], length: v } })); }} />
                    <div style={{ height: "1px", background: "rgba(90,127,200,0.25)" }} />
                    <SizeInputRow label={`${sideLabel}鞋垫宽度`} value={insoleSize[side].width} onChange={(v) => { markSolutionEdited(); setInsoleSize((s) => ({ ...s, [side]: { ...s[side], width: v } })); }} />
                  </div>
                  <div style={{ background: "#E7EFFF", borderRadius: "12px", padding: "12px 14px", fontSize: "14px", fontWeight: 700, color: "#17191C" }}>
                    匹配鞋码：中国{shoeSizeFor(side)}码
                  </div>
                </div>
              </CardBody>
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
              <CardBody gap={8}>
                <ThickPillRow label="足弓矫正厚度" value={`+${committed[side].params.archCorrection}mm`} adjusted={adjusted.arch} tip={TIP.archCorrection} />
                {/* 标准垫走压力自适应基础厚度 */}
                <ThickPillRow label="基础厚度" value={`${(committed[side].params.baseThickness * 10).toFixed(1)}mm`} adjusted={adjusted.base} tip={STYLE_DEFS[INSOLE_STYLE].heightMode === "proportional" ? TIP.base : TIP.baseAdaptive} />
                <ThickPillRow label="足跟缓冲厚度" value={`${committed[side].params.heelThickness}mm`} adjusted={adjusted.heel} tip={TIP.heel} />
              </CardBody>
            </Card>
          </div>
        </section>

        {/* 底栏进 grid 第三行、随内容流动（与报告页一致）：矮屏滚动时不会浮在卡片上 */}
        <BottomBar
          userName={currentUser?.name ?? "—"}
          userId={formatUserId(currentUser?.id)}
          onBack={handleRemeasure}
          onRestart={handleFinish}
          onDownload={() => { if (guardSizes()) setOverlay("download"); }}
          downloadReady={sizesFilled}
        />
      </main>

      {/* ── 鞋垫参数调节抽屉（厚度 + 软硬） ── */}
      {overlay === "drawer" && (
        <>
          <SidebarDim />
          <DrawerPanel title="鞋垫参数调节" onReset={resetDefaults}>
            <ThicknessSliders fs={cur} sys={defaults?.[side]} onParams={editParams} drawerMode style={INSOLE_STYLE} />

            {/* 软硬调节：Shore A 硬度 */}
            <DetailSectionHeader title="软硬调节" onReset={resetSoftness} style={{ marginTop: "8px" }} />
            <StepperSliderRow label="鞋垫软硬" tip={TIP.hardness} value={cur.hardness} min={20} max={60} step={1} unit="Shore A" hints={["软", "硬"]} tightHints systemValue={defaults?.[side].hardness} onChange={(v) => editHardness(v)} />

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
          stlLeft={toStlParams(sizedFoot("left", committed.left))}
          stlRight={toStlParams(sizedFoot("right", committed.right))}
          deformLeft={toDeform(sizedFoot("left", committed.left), INSOLE_STYLE)}
          deformRight={toDeform(sizedFoot("right", committed.right), INSOLE_STYLE)}
          color={C.insoleColor}
          style={INSOLE_STYLE}
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
      {/* 尺寸已填齐也要告知一声，用户才知道刚调的参数不会随着离开这页丢掉 */}
      {confirm === "remeasureSaved" && (
        <ConfirmModal
          title="重新测量"
          body={`本次方案已保存到「${currentUser?.name ?? "当前用户"}」的历史记录，可随时回看并重新下载鞋垫文件。是否重新测量？`}
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
      {/* 尺寸已填齐也要告知一声，用户才知道点下去不会白填；具体存了哪些不必展开 */}
      {confirm === "finishSaved" && (
        <ConfirmModal
          title="结束体验"
          body={`本次方案已保存到「${currentUser?.name ?? "当前用户"}」的历史记录，可随时回看并重新下载鞋垫文件。是否结束本次体验？`}
          confirmLabel="结束体验"
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); onRestart(); }}
        />
      )}

      <style>{`
        /* 常规屏一屏放完：顶栏 / 3D 舞台（弹性）/ 参数面板 / 固定底栏，舞台吃掉剩余高度。
           矮屏放不下时舞台收到最小高度后整页纵向滚动——不能 overflow:hidden 把参数卡裁掉 */
        .sol-shell {
          --sol-pad-x: clamp(28px, 4.2vw, 78px);
          --sol-topbar-h: clamp(72px, 9vh, 96px);
          position: relative;
          height: 100vh;
          /* 两向都允许滚动：窄窗口 / 高倍缩放下内容真装不下时给横向滚动条，绝不裁掉 */
          overflow: auto;
          font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
        }
        /*
         * grid 而非 flex：两行 = 3D 舞台(minmax(260px,1fr)) / 参数面板(auto)。
         * min-height 让内容超出一屏时随内容撑高、由 .sol-shell 滚动；
         * flex 容器只有 min-height 时子项高度"不确定"，3D 画布的 height:100% 会塌成 150px，
         * grid 的网格区域布局后一律视为确定尺寸——所以这里必须是 grid（报告页同理）。
         */
        .sol-main {
          position: relative;
          z-index: 1;
          display: grid;
          /* 列轨道必须显式 minmax(0,1fr)：默认的 auto 列会把 3D 画布的像素缓冲宽度（CSS 宽 × dpr）
             当成最小内容宽度，浏览器放大到 150% 时整页被撑到 1.5 倍宽、鞋垫和卡片被推出视口 */
          grid-template-columns: minmax(0, 1fr);
          /* 舞台下限 340：含 46px 标题行，画布至少 ~294px——再矮鞋垫在宽扁画布里只剩一小块，
             红蓝定制量看不清。矮屏宁可多滚几十像素 */
          grid-template-rows: minmax(340px, 1fr) auto auto;
          min-height: 100%;
          padding: var(--sol-topbar-h) var(--sol-pad-x) 0;
        }
        .sol-stage {
          position: relative;
          display: flex;
          flex-direction: column;
          min-height: 0;
          min-width: 0;
        }
        .sol-stage-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .sol-viewer { flex: 1; min-height: 0; min-width: 0; position: relative; }
        .sol-panel {
          border-top: 1px solid rgba(0,53,155,0.1);
          padding-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sol-panel-head { display: flex; align-items: center; justify-content: space-between; }
        .sol-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          /* 三卡等高：同一行统一拉到最高那张的高度 */
          align-items: stretch;
        }
        @media (max-width: 1180px) {
          .sol-grid { grid-template-columns: 1fr; }
        }
        @keyframes drawerUp { from { opacity:0; transform: translateY(24px); } to { opacity:1; transform: translateY(0); } }
        @keyframes modalIn { from { opacity:0; transform: scale(0.97); } to { opacity:1; transform: scale(1); } }
        @keyframes slideDown { from { opacity:0; transform: translate(-50%,-12px); } to { opacity:1; transform: translate(-50%,0); } }
      `}</style>
    </div>
  );
}

// ─── 页面弱化蒙版（抽屉打开时铺满整页，浮层之下；3D 与参数卡都还隐约可见） ────────
function SidebarDim() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#8C929E",
        opacity: 0.55,
        zIndex: 35,
      }}
    />
  );
}

// ─── 抽屉容器（白底、放大，对齐设计稿第二页） ──────────────────────────────────
function DrawerPanel({ title, onReset, children }: { title: string; onReset: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", right: "16px", bottom: "16px", width: "min(500px, 40vw)", minWidth: "440px", maxHeight: "calc(100vh - 120px)", overflowY: "auto", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 16px 56px rgba(14,45,106,0.24)", padding: "22px 24px", zIndex: 40, animation: "drawerUp 0.25s cubic-bezier(0.23,1,0.32,1)", border: `1px solid ${C.border}` }}>
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
        <button onClick={onCancel} style={{ background: "rgba(92,138,232,0.15)", border: `1.5px solid #3768CC`, borderRadius: "8px", height: "38px", padding: "0 22px", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: C.primaryDeep }}>取消</button>
        <button onClick={onSave} style={{ background: C.primary, border: "none", borderRadius: "8px", height: "38px", padding: "0 26px", cursor: "pointer", fontSize: "13px", fontWeight: 700, color: "#fff" }}>{saveLabel}</button>
      </div>
    </div>
  );
}

// section 标题 + 重置（抽屉内软硬调节复用）
function DetailSectionHeader({ title, onReset, style, tip }: { title: string; onReset: () => void; style?: React.CSSProperties; tip?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: C.dark }}>{title}</span>
        {tip && <InfoTip text={tip} size={13} />}
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,21,40,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 }}>
      <div style={{ width: "480px", maxWidth: "92vw", background: "linear-gradient(180deg, #F1F6FF 0%, #E5EEFF 100%)", borderRadius: "18px", border: "1.5px solid #ADBEE1", boxShadow: "0 18px 60px rgba(17,47,105,0.22)", overflow: "hidden", animation: "modalIn 0.2s ease" }}>
        {/* 头 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "22px 26px 0" }}>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "#17191C", letterSpacing: "0.08em" }}>{title}</span>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "22px", color: "#929292", lineHeight: 1 }}>×</button>
        </div>
        {/* 正文 */}
        <p style={{ margin: "18px 26px 26px", fontSize: "16px", lineHeight: 1.75, color: "#17191C", fontWeight: 500 }}>{body}</p>
        {/* 底部两枚按钮 + 竖分隔 */}
        <div style={{ display: "flex", alignItems: "stretch", borderTop: "1px solid #ADBEE1" }}>
          <button onClick={onCancel} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 600, color: "#929292", padding: "16px 0" }}>取消</button>
          <div style={{ width: "1px", background: "#ADBEE1" }} />
          <button onClick={onConfirm} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 700, color: "#00359F", padding: "16px 0" }}>{confirmLabel}</button>
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

  const cellBorder = "1px solid rgba(110,140,200,0.35)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,21,40,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div style={{ width: "960px", maxWidth: "94vw", height: "580px", maxHeight: "90vh", background: "#FFFFFF", borderRadius: "18px", boxShadow: "0 16px 60px rgba(10,47,120,0.28)", display: "flex", overflow: "hidden", animation: "modalIn 0.22s ease" }}>
        {/* 左：3D 预览（浅色底）。overflow:hidden 兜住画布，任何情况都不越过弹窗圆角边框 */}
        <div style={{ flex: 1, position: "relative", minWidth: 0, background: "#F6F8FC", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "20px", left: "24px", display: "flex", alignItems: "baseline", gap: "10px", zIndex: 2 }}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: C.dark }}>双脚3D鞋垫展示</span>
            <span style={{ fontSize: "12px", color: C.sub }}>3D Dual-Foot Insole View</span>
          </div>
          <StlInsoleViewer
            activeFoot="both"
            style={style}
            color={color}
            leftParams={stlLeft}
            rightParams={stlRight}
            leftDeform={deformLeft}
            rightDeform={deformRight}
          />
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
                    <th key={h} style={{ textAlign: "center", padding: "10px 6px", border: cellBorder, background: "rgba(7,59,163,0.1)", color: C.dark, fontWeight: 700 }}>{h}</th>
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
            <button onClick={() => onDownload("stl")} style={{ flex: 1, background: C.primary, border: "none", borderRadius: "8px", height: "44px", cursor: "pointer", fontSize: "15px", fontWeight: 700, color: "#fff", boxShadow: "0 3px 10px rgba(7,59,163,0.3)" }}>下载文件</button>
          </div>
        </div>
      </div>
    </div>
  );
}
