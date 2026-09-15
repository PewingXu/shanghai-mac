/**
 * ReportPage — 步骤3：报告分析页面
 *
 * 视图1（足弓标注）：左侧 3D 足底模型 + 尺寸标注线（宽度/长度），右侧报告面板
 * 视图2（热力区域）：左侧 2D 足底轮廓 + 趾/前/中/后足四色方块分区，右侧报告面板
 *
 * 切换按钮位于左侧区域右上角，与设计图一致
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useApp, type MeasureAnalysis } from "@/contexts/AppContext";
import { formatUserId } from "@/lib/utils";
import FeetModel3D, {
  equalizeZoneBounds,
  type FootAnno,
  type ZoneBounds,
  type ZoneSections,
} from "@/components/FeetModel3D";
import BrandLogo from "@/components/BrandLogo";
import HistoryLink from "@/components/HistoryLink";

// 报告页图标（设计稿原件切图，均已英文命名迁入项目）
const RICON = (name: string) => `/assets/icons/report-page/${name}.svg`;

// COP 热力图颜色映射上限（同采集页 colorLevel 默认；调小更浓）
const COP_HEAT_VMAX = 128;

// ─── 通用子组件 ───────────────────────────────────────────────────────────────
function SectionTitle({ zh, en }: { zh: string; en: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "10px" }}>
      <span style={{ width: "3px", height: "14px", background: "#073BA3", borderRadius: "2px", display: "inline-block", marginRight: "2px", flexShrink: 0 }} />
      <span style={{ fontSize: "14px", fontWeight: "700", color: "#101E3A" }}>{zh}</span>
      <span style={{ fontSize: "11px", color: "#40598A" }}>{en}</span>
    </div>
  );
}

function MeasureRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div style={{ display: "flex", gap: "0", background: "rgba(255,255,255,0.7)", borderRadius: "10px", overflow: "hidden", marginBottom: "8px" }}>
      {items.map((item, i) => (
        <div key={i} style={{ flex: 1, padding: "10px 14px", borderRight: i < items.length - 1 ? "1px solid rgba(7,59,163,0.15)" : "none" }}>
          <div style={{ fontSize: "11px", color: "#40598A", marginBottom: "4px" }}>{item.label}</div>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#101E3A" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function ArchCard({ side, type, index, showTag }: { side: string; type: string; index: string; showTag?: boolean }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: "10px", padding: "10px 14px" }}>
      <div style={{ fontSize: "11px", color: "#40598A", marginBottom: "4px" }}>{side}脚足弓类型</div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontSize: "16px", fontWeight: "700", color: "#073BA3" }}>{type}</span>
        {showTag && (
          <span style={{ fontSize: "10px", background: "rgba(7,59,163,0.15)", color: "#073BA3", borderRadius: "4px", padding: "2px 6px" }}>有足弓内翻迹象</span>
        )}
      </div>
      <div style={{ fontSize: "11px", color: "#40598A" }}>足弓指数 <span style={{ color: "#101E3A", fontWeight: "600" }}>{index}</span></div>
    </div>
  );
}

function CopRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <div style={{ fontSize: "10px", color: "#40598A" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "#101E3A" }}>{value}<span style={{ fontSize: "10px", fontWeight: "400", marginLeft: "2px" }}>{unit}</span></div>
    </div>
  );
}

// ─── 视图1：3D 模型 + 尺寸标注 ───────────────────────────────────────────────
function DimensionLabel({ text, style }: { text: string; style: React.CSSProperties }) {
  return (
    <div style={{
      position: "absolute",
      background: "#000000",
      color: "#fff",
      fontSize: "15px",
      fontWeight: "700",
      padding: "4px 13px",
      borderRadius: "6px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      zIndex: 10,
      ...style,
    }}>
      {text}
    </div>
  );
}

function MeasureDot({ style }: { style: React.CSSProperties }) {
  return (
    <div style={{
      position: "absolute",
      width: "17px",
      height: "17px",
      borderRadius: "50%",
      background: "#073DAB",
      boxShadow: "0 1px 4px rgba(20,53,119,0.35)",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      zIndex: 10,
      ...style,
    }} />
  );
}

// 水平测量线（带两端箭头）
function HMeasureLine({ top, left, right, color = "#073BA3" }: { top: string; left: string; right: string; color?: string }) {
  return (
    <div style={{
      position: "absolute",
      top,
      left,
      right,
      height: "1px",
      background: color,
      opacity: 0.7,
      zIndex: 9,
      pointerEvents: "none",
    }}>
      <div style={{ position: "absolute", left: 0, top: "-3px", width: "1px", height: "7px", background: color }} />
      <div style={{ position: "absolute", right: 0, top: "-3px", width: "1px", height: "7px", background: color }} />
    </div>
  );
}

// 垂直测量线（带两端横线）
function VMeasureLine({ left, top, bottom, color = "#073BA3" }: { left: string; top: string; bottom: string; color?: string }) {
  return (
    <div style={{
      position: "absolute",
      left,
      top,
      bottom,
      width: "1px",
      background: color,
      opacity: 0.7,
      zIndex: 9,
      pointerEvents: "none",
    }}>
      <div style={{ position: "absolute", top: 0, left: "-3px", width: "7px", height: "1px", background: color }} />
      <div style={{ position: "absolute", bottom: 0, left: "-3px", width: "7px", height: "1px", background: color }} />
    </div>
  );
}

/**
 * 视图1：俯视 + 工程制图式尺寸标注。
 * 深色底衬 = 足底投影包围盒（bounding box）；横/竖线 = 尺寸线（dimension line）。
 * 包围盒由 FeetModel3D 的真实 3D 投影回调（onFootRects）驱动 —— 与脚模自动精确贴合，
 * 脚模缩放/容器尺寸变化都会重新对齐。脚模缩放取采集页最大档（3.66），与采集时一致。
 */
// 报告页脚模缩放：与采集页默认档（MeasurePage.MODEL_SCALE_DEFAULT = 3.5）一致，
// 舞台高度也按采集页同一公式给（100vh − 顶栏 − 控制坞），两页脚模像素尺寸相同
const REPORT_FOOT_SCALE = 3.5;
// 分区色块相对脚模投影矩形的放大系数（1.0=恰好填满投影矩形；>1 放大整簇，格间距不变）
const ZONE_FILL_SCALE = 1.15;

/**
 * 足部主舞台：足底尺寸（俯视）与足弓分析（站姿）共用同一 Canvas。
 * 切换 mode 时脚模做旋转过渡（pose 动画），动画完成后标注再淡入展开。
 */
function FootStage({ dims, arch, mode }: { dims: ReportData["dims"]; arch: ReportData["arch"]; mode: ReportView }) {
  const { analysis } = useApp();
  const d = dims;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<{ left: FootAnno; right: FootAnno } | null>(null);
  const handleRects = useCallback((r: { left: FootAnno; right: FootAnno }) => {
    setRects((prev) => (prev && JSON.stringify(prev) === JSON.stringify(r) ? prev : r));
  }, []);

  // 足底尺寸/压力面积/COP 同为俯视视角；仅足弓分析为站姿。
  // 同视角互切不旋转（仅换叠加层），仅进/出足弓分析才做旋转过渡。
  const pose: "top" | "standing" = mode === "arch" ? "standing" : "top";
  const [settled, setSettled] = useState(false);
  const prevPoseRef = useRef<"top" | "standing">(pose);
  useEffect(() => {
    if (prevPoseRef.current !== pose) {
      setSettled(false); // 仅视角切换（进/出足弓分析）才等待旋转过渡
      prevPoseRef.current = pose;
    }
  }, [pose]);
  const handleSettled = useCallback(() => setSettled(true), []);

  // 容器像素尺寸（分区覆盖层 canvas / 百分比标注换算用）
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ===== 压力/面积：足弓分区（Python section_coords；缺失回退 demo 并显示水印）=====
  const sections = useMemo(() => {
    const af = analysis?.python?.success ? analysis.python.data.arch_features : null;
    const L = af ? normalizeSectionCoords(af.left_foot?.section_coords) : [];
    const R = af ? normalizeSectionCoords(af.right_foot?.section_coords) : [];
    const realL = L.length >= 4 && L.some((s) => s?.length);
    const realR = R.length >= 4 && R.some((s) => s?.length);
    return {
      left: realL ? L : demoSections(false),
      right: realR ? R : demoSections(true),
      // 任一侧回退演示分区 → 界面显式提示（曾因 Python 环境缺依赖静默兜底，被误当真实数据）
      isDemo: !realL || !realR,
    };
  }, [analysis]);

  const zoneCanvasRef = useRef<HTMLCanvasElement>(null);
  // 分区绘制几何：左右脚 bounds 等化 → 等比缩放、居中于各自脚模投影矩形（放大铺满脚模）
  const geo = useMemo(() => {
    if (!rects || !box) return null;
    const eq = equalizeZoneBounds(sections.left, sections.right);
    const calc = (secs: ZoneSections, eqB: ZoneBounds | null, rect: FootAnno["rect"]): FootZoneGeo | null => {
      if (!eqB) return null;
      const rows = eqB.rMax - eqB.rMin + 1;
      const cols = eqB.cMax - eqB.cMin + 1;
      const rx = (rect.left / 100) * box.w;
      const ry = (rect.top / 100) * box.h;
      const rw = (rect.width / 100) * box.w;
      const rh = (rect.height / 100) * box.h;
      const scale = Math.min(rw / cols, rh / rows) * ZONE_FILL_SCALE; // 放大铺满脚模
      const x0 = rx + (rw - cols * scale) / 2;
      const y0 = ry + (rh - rows * scale) / 2;
      let dMin = Infinity;
      let dMax = -Infinity;
      secs.forEach((sec) =>
        (sec ?? []).forEach(([r]) => {
          if (r < dMin) dMin = r;
          if (r > dMax) dMax = r;
        }),
      );
      if (!isFinite(dMin)) return null;
      const span = dMax - dMin + 1;
      const at = (cum: number) => ((y0 + (dMin - eqB.rMin + (cum / 15) * span) * scale) / box.h) * 100;
      return {
        eqB,
        scale,
        x0,
        y0,
        centers: [at(1.5), at(5), at(9), at(13)],
        bounds: [at(3), at(7), at(11)],
      };
    };
    return {
      left: calc(sections.left, eq.left, rects.left.rect),
      right: calc(sections.right, eq.right, rects.right.rect),
    };
  }, [sections, rects, box]);

  // 分区色块覆盖层（2D 直绘；仅压力/面积模式、且旋转过渡完成后绘制）
  useEffect(() => {
    const canvas = zoneCanvasRef.current;
    if (!canvas || !box) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, box.w, box.h);
    if (mode !== "pressure" || !geo || !settled) return;
    const drawSide = (secs: ZoneSections, g: FootZoneGeo | null) => {
      if (!g) return;
      // 格间距固定为"放大前基准格距"的 10%（除掉 FILL_SCALE）→ 整簇放大但缝不变
      const gap = Math.max(1, (g.scale / ZONE_FILL_SCALE) * 0.1);
      const size = g.scale - gap;
      const rad = Math.min(2.5, size * 0.16);
      secs.forEach((sec, zi) => {
        ctx.fillStyle = ZONE_CELL_COLORS[zi % ZONE_CELL_COLORS.length];
        (sec ?? []).forEach((p) => {
          if (!p || p.length < 2) return;
          const [r, c] = p;
          const x = g.x0 + (c - g.eqB.cMin) * g.scale + gap / 2;
          const y = g.y0 + (r - g.eqB.rMin) * g.scale + gap / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, size, size, rad);
          ctx.fill();
        });
      });
    };
    drawSide(sections.left, geo.left);
    drawSide(sections.right, geo.right);
  }, [sections, geo, box, mode, settled]);

  const chip = (zi: number, count: number, x: number, y: number, alignRight: boolean, key: string) => (
    <div
      key={key}
      style={{
        position: "absolute",
        top: `${y}%`,
        left: `${x}%`,
        transform: `translate(${alignRight ? "-100%" : "0"}, -50%)`,
        background: ZONE_META[zi].bg,
        border: `1.5px solid ${ZONE_META[zi].color}`,
        color: ZONE_META[zi].color,
        borderRadius: "8px",
        padding: "4px 12px",
        fontSize: "14px",
        fontWeight: 700,
        whiteSpace: "nowrap",
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      {ZONE_META[zi].label}({count})
    </div>
  );

  // ===== COP 平衡指标（压力中心）=====
  // 底图帧：arch_features.peak_frame_data（多帧=平均帧），与 COP 轨迹/内外侧线同帧同坐标系。
  const peakMatrix = useMemo(() => {
    const pd = analysis?.python?.success ? analysis.python.data.arch_features?.peak_frame_data : null;
    if (!pd || pd.length < 4096) return null;
    const m: number[][] = [];
    for (let r = 0; r < 64; r++) m.push(pd.slice(r * 64, r * 64 + 64));
    return m;
  }, [analysis]);
  // 喂给 FeetModel3D 的热力图帧：Python 帧是 [row][col] 已规范化方向，而组件内部 transpose 期望"原始帧"，
  // 故先转置一次（peakHeat[col][row]）→ 组件 transpose 后恢复正确方向，热力图按采集页方法烤到 3D 脚面。
  const peakHeat = useMemo(() => {
    if (!peakMatrix) return null;
    const t: number[][] = [];
    for (let c = 0; c < 64; c++) {
      const row = new Array<number>(64);
      for (let r = 0; r < 64; r++) row[r] = peakMatrix[r][c];
      t.push(row);
    }
    return t;
  }, [peakMatrix]);
  // COP 轨迹：Python left/right_cop_trajectory = [[row, col], ...]（左脚 col 0–31 / 右脚 col 32–63）
  const cop = useMemo(() => {
    const d = analysis?.python?.success ? analysis.python.data : null;
    return { left: d?.left_cop_trajectory ?? null, right: d?.right_cop_trajectory ?? null };
  }, [analysis]);
  const hasCop = !!(peakMatrix && (cop.left?.length || cop.right?.length));

  const copCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = copCanvasRef.current;
    if (!canvas || !box) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, box.w, box.h);
    if (mode !== "cop" || !geo || !settled || !peakMatrix) return;

    const drawFoot = (
      g: FootZoneGeo | null,
      colStart: number,
      colEnd: number,
      copPts: number[][] | null,
      side: "left" | "right",
    ) => {
      if (!g) return;
      const cell = g.scale;
      // 网格(row, 全局col) → 画布像素（+0.5 落到格心）；与热力图贴图区域同一映射 → 天然对齐
      const toPx = (row: number, colGlobal: number) => ({
        x: g.x0 + (colGlobal - g.eqB.cMin + 0.5) * cell,
        y: g.y0 + (row - g.eqB.rMin + 0.5) * cell,
      });
      // 热力图已由 FeetModel3D 烤到 3D 脚面（采集页做法），此处只叠 COP 轨迹 + 内外侧线
      // 平滑折线（二次贝塞尔过中点）→ 线条顺滑不生硬
      const smoothPath = (ps: { x: number; y: number }[]) => {
        const path = new Path2D();
        if (ps.length < 2) return path;
        path.moveTo(ps[0].x, ps[0].y);
        for (let i = 1; i < ps.length - 1; i++) {
          const mx = (ps[i].x + ps[i + 1].x) / 2;
          const my = (ps[i].y + ps[i + 1].y) / 2;
          path.quadraticCurveTo(ps[i].x, ps[i].y, mx, my);
        }
        path.lineTo(ps[ps.length - 1].x, ps[ps.length - 1].y);
        return path;
      };
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // COP 轨迹：柔白外发光 + 绿→红渐变平滑线 + 起/终点白环标记（无生硬黑边）
      const pts = (copPts ?? []).filter((p) => Array.isArray(p) && p.length >= 2).map((p) => toPx(p[0], p[1]));
      const marker = (p: { x: number; y: number }, color: string) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      };
      if (pts.length >= 2) {
        const path = smoothPath(pts);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; // 柔白发光，在暖色底上清楚
        ctx.lineWidth = 5.5;
        ctx.stroke(path);
        const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
        grad.addColorStop(0, "#16a34a");
        grad.addColorStop(1, "#ef4444");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.8;
        ctx.stroke(path);
        ctx.restore();
        marker(pts[0], "#16a34a");
        marker(pts[pts.length - 1], "#ef4444");
      } else if (pts.length === 1) {
        marker(pts[0], "#16a34a");
      }
    };

    drawFoot(geo.left, 0, 32, cop.left, "left");
    drawFoot(geo.right, 32, 64, cop.right, "right");
  }, [mode, geo, box, settled, peakMatrix, cop]);

  /**
   * 底衬为两层深浅不同的条带（对齐设计稿），交叠处自然更深：
   * - 纵向条带（深）：由横向宽度虚线划定，宽=足宽，从宽度线延伸到脚底；
   * - 横向条带（浅）：由纵向长度虚线划定，高=足长，从长度线延伸到脚另一侧。
   */
  const renderShade = (anno: FootAnno, isL: boolean, key: string) => {
    const rc = anno.rect;
    const lenX = isL ? rc.left - 4 : rc.left + rc.width + 4; // 与长度尺寸线同位
    // 浅条带边界：外侧=长度虚线；内侧收到趾尖点 x（脚下半段内缘向内收，
    // 若延伸到内侧切点 x 会在中缝露出背景）；高度到脚跟切点
    const bandL = isL ? lenX : Math.max(anno.sideL.x, anno.toe.x);
    const bandR = isL ? Math.min(anno.sideR.x, anno.toe.x) : lenX;
    const lightH = anno.heel.y - rc.top;
    // 纵向深底衬：不规则四边形——顶边=宽度线，左右边界分别延伸到左/右切点（高度不同），
    // 底边为连接两切点的斜边（用 clip-path 裁出）
    const bandBottom = Math.max(anno.sideL.y, anno.sideR.y);
    const bandH = Math.max(0.01, bandBottom - rc.top);
    const clipL = ((anno.sideL.y - rc.top) / bandH) * 100;
    const clipR = ((anno.sideR.y - rc.top) / bandH) * 100;
    return (
      <div key={key}>
        {/* 纵向底衬（深）：梯形区域，底边随左右切点高度倾斜 */}
        <div
          style={{
            position: "absolute",
            left: `${anno.sideL.x}%`,
            top: `${rc.top}%`,
            width: `${anno.sideR.x - anno.sideL.x}%`,
            height: `${bandH}%`,
            background: "rgba(30,90,209,0.2)",
            clipPath: `polygon(0% 0%, 100% 0%, 100% ${clipR}%, 0% ${clipL}%)`,
          }}
        />
        {/* 横向条带（浅）：长度虚线到对侧宽度虚线，高度到脚跟切点 */}
        <div style={{ position: "absolute", left: `${bandL}%`, top: `${rc.top}%`, width: `${bandR - bandL}%`, height: `${lightH}%`, background: "rgba(30,90,209,0.12)" }} />
      </div>
    );
  };

  // 虚线（尺寸界线）与双箭头实线（尺寸线）。宽度组用深橙、长度组用浅橙（设计稿双色）
  const WID_COLOR = "#0A3997";
  const LEN_COLOR = "#2558BE";
  const dashV = (x: number, top: number, bottom: number, color: string, key: string) => (
    <div key={key} className="anno-grow-v" style={{ position: "absolute", left: `${x}%`, top: `${top}%`, height: `${bottom - top}%`, borderLeft: `1.5px dashed ${color}`, pointerEvents: "none", zIndex: 9 }} />
  );
  const dashH = (y: number, left: number, right: number, color: string, key: string) => (
    <div key={key} className="anno-grow-h" style={{ position: "absolute", top: `${y}%`, left: `${left}%`, width: `${right - left}%`, borderTop: `1.5px dashed ${color}`, pointerEvents: "none", zIndex: 9 }} />
  );
  const tri = (dir: "l" | "r" | "u" | "d", color: string): React.CSSProperties => ({
    position: "absolute",
    width: 0,
    height: 0,
    ...(dir === "l" && { left: -1, top: -4.5, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderRight: `7px solid ${color}` }),
    ...(dir === "r" && { right: -1, top: -4.5, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `7px solid ${color}` }),
    ...(dir === "u" && { top: -1, left: -4.5, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `7px solid ${color}` }),
    ...(dir === "d" && { bottom: -1, left: -4.5, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `7px solid ${color}` }),
  });
  const arrowH = (y: number, left: number, right: number, color: string, key: string) => (
    <div key={key} className="anno-grow-h" style={{ position: "absolute", top: `${y}%`, left: `${left}%`, width: `${right - left}%`, borderTop: `1.5px solid ${color}`, pointerEvents: "none", zIndex: 9 }}>
      <div style={tri("l", color)} />
      <div style={tri("r", color)} />
    </div>
  );
  const arrowV = (x: number, top: number, bottom: number, color: string, key: string) => (
    <div key={key} className="anno-grow-v" style={{ position: "absolute", left: `${x}%`, top: `${top}%`, height: `${bottom - top}%`, borderLeft: `1.5px solid ${color}`, pointerEvents: "none", zIndex: 9 }}>
      <div style={tri("u", color)} />
      <div style={tri("d", color)} />
    </div>
  );

  const renderFoot = (anno: FootAnno, side: "L" | "R") => {
    const isL = side === "L";
    const rc = anno.rect;
    const bottom = anno.heel.y; // 底边用脚跟切点真实高度（包围盒底可能被踝后方顶点拉低）
    // 四个解剖测量点（真实轮廓切点，由 3D 投影给出）：趾尖、脚跟、屏幕左/右最宽点
    const { toe, heel, sideL, sideR } = anno;
    const lenX = isL ? rc.left - 4 : rc.left + rc.width + 4; // 长度尺寸线（外侧）

    return (
      <div key={side}>
        {/* 四个解剖测量点：全部用切点真实坐标，必然贴在脚轮廓上 */}
        <MeasureDot style={{ top: `${rc.top}%`, left: `${toe.x}%` }} />
        <MeasureDot style={{ top: `${bottom}%`, left: `${heel.x}%` }} />
        <MeasureDot style={{ top: `${sideL.y}%`, left: `${sideL.x}%` }} />
        <MeasureDot style={{ top: `${sideR.y}%`, left: `${sideR.x}%` }} />

        {/* 足宽（深橙）：实线/虚线均以切点 x 为界（前掌最宽），两端虚线上抵标签、下达各自切点 */}
        {arrowH(rc.top, sideL.x, sideR.x, WID_COLOR, `${side}-aw`)}
        {dashV(sideL.x, rc.top - 4, sideL.y, WID_COLOR, `${side}-dl`)}
        {dashV(sideR.x, rc.top - 4, sideR.y, WID_COLOR, `${side}-dr`)}
        <DimensionLabel
          text={`${side}:${isL ? d.leftWid : d.rightWid}mm`}
          style={{ top: `${rc.top - 6}%`, left: `${(sideL.x + sideR.x) / 2}%`, transform: "translateX(-50%)" }}
        />

        {/* 足长（浅橙）：外侧竖直双箭头实线；顶部虚线只画宽度线外的延伸段（不穿过实线），底部虚线贯穿 */}
        {arrowV(lenX, rc.top, bottom, LEN_COLOR, `${side}-al`)}
        {isL
          ? dashH(rc.top, lenX, sideL.x, LEN_COLOR, `${side}-dt`)
          : dashH(rc.top, sideR.x, lenX, LEN_COLOR, `${side}-dt`)}
        {dashH(bottom, Math.min(lenX, rc.left), Math.max(rc.left + rc.width, lenX), LEN_COLOR, `${side}-db`)}
        <DimensionLabel
          text={`${side}:${isL ? d.leftLen : d.rightLen}mm`}
          style={{ top: `${rc.top + rc.height / 2}%`, left: `${isL ? lenX - 1.5 : lenX + 1.5}%`, transform: isL ? "translate(-100%, -50%)" : "translateY(-50%)" }}
        />
      </div>
    );
  };

  // 足弓分析（站姿）标注：圆点 + 水平实线 + 竖直虚线双箭头（位置为站姿视角近似值，可调）
  const archMark = (dotX: number, dotY: number, lineEndX: number, baseY: number, isL: boolean, key: string) => (
    <div key={key}>
      <MeasureDot style={{ top: `${dotY}%`, left: `${dotX}%`, background: WID_COLOR }} />
      {/* 点旁水平实线 */}
      <div style={{ position: "absolute", top: `${dotY}%`, left: `${Math.min(dotX, lineEndX)}%`, width: `${Math.abs(lineEndX - dotX)}%`, borderTop: `2px solid ${WID_COLOR}`, zIndex: 9, pointerEvents: "none" }} />
      {/* 纵向虚线双箭头：从上往下展开 */}
      <div className="anno-grow-v" style={{ position: "absolute", left: `${lineEndX}%`, top: `${dotY}%`, height: `${baseY - dotY}%`, borderLeft: `1.5px dashed ${WID_COLOR}`, zIndex: 9, pointerEvents: "none" }}>
        <div style={tri("u", WID_COLOR)} />
        <div style={tri("d", WID_COLOR)} />
      </div>
    </div>
  );

  /** 底部地面基准线：渲染在脚模下层，伸入脚的部分被脚盖住，端点呈"刚好接触"效果 */
  const archBase = (lineEndX: number, baseY: number, isL: boolean, key: string) => (
    <div
      key={key}
      style={{ position: "absolute", top: `${baseY}%`, left: `${isL ? lineEndX - 6 : lineEndX - 2.6}%`, width: "8.6%", borderTop: `2px solid ${WID_COLOR}`, pointerEvents: "none" }}
    />
  );

  const showDims = mode === "dims" && settled && rects;

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* 底衬在脚模之下（仅俯视尺寸模式） */}
      {showDims && (
        <div className="anno-appear-under">
          {renderShade(rects.left, true, "sL")}
          {renderShade(rects.right, false, "sR")}
        </div>
      )}
      <FeetModel3D
        width="100%"
        height="100%"
        modelScale={REPORT_FOOT_SCALE} // 四视图同一脚模：大小/位置不变，仅进/出足弓分析旋转
        lockedView
        pose={pose}
        onPoseSettled={handleSettled}
        onFootRects={handleRects}
        // COP 视图：把平均帧当纹理烤到 3D 脚面（同采集页做法，自动贴合脚形/按轮廓裁剪）
        pressureData={mode === "cop" && hasCop ? peakHeat : null}
        heatVmax={COP_HEAT_VMAX}
        style={{ position: "relative", zIndex: 1 }}
      />

      {/* 压力/面积：分区色块 2D 覆盖层（锐利、格间留缝）；随交互从中心向外展开 */}
      {mode === "pressure" && settled && (
        <canvas
          key="zone-canvas"
          ref={zoneCanvasRef}
          className="zone-grow"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none" }}
        />
      )}

      {/* COP：暖色插值热力图 + 内外侧分界线 + COP 轨迹（2D 覆盖层，同 geo 映射，天然对齐） */}
      {mode === "cop" && settled && hasCop && (
        <canvas
          key="cop-canvas"
          ref={copCanvasRef}
          className="zone-grow"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 5, pointerEvents: "none" }}
        />
      )}

      {/* 足底尺寸标注 */}
      {showDims && (
        <div className="anno-appear">
          {renderFoot(rects.left, "L")}
          {renderFoot(rects.right, "R")}
        </div>
      )}

      {/* 足弓分析标注（站姿） */}
      {mode === "arch" && settled && (
        <>
          {/* 地面基准线在脚模下层：伸入脚的部分被脚盖住，端点"刚好接触" */}
          <div className="anno-appear-under">
            {archBase(47, 64, true, "archBaseL")}
            {archBase(53, 64, false, "archBaseR")}
          </div>
          <div className="anno-appear">
            {archMark(42.5, 46, 47, 64, true, "archL")}
            {archMark(57.5, 46, 53, 64, false, "archR")}
            {/* 左脚标签右对齐到中线左侧、右脚标签左对齐到中线右侧：
                type 是"高足弓(high arch)"这类中英双语长文本时，也绝不会在中间重叠 */}
            <DimensionLabel text={`左脚·${arch.left.type}`} style={{ top: "40%", left: "48%", transform: "translate(-100%, -100%)" }} />
            <DimensionLabel text={`右脚·${arch.right.type}`} style={{ top: "40%", left: "52%", transform: "translate(0, -100%)" }} />
          </div>
        </>
      )}

      {/* 压力/面积：分区回退演示数据时的显式提示（防止误当真实分析结果） */}
      {mode === "pressure" && settled && sections.isDemo && (
        <div className="anno-appear">
          <span style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", fontSize: "12px", fontWeight: 700, color: "#083080", background: "rgba(255,255,255,0.85)", padding: "4px 14px", borderRadius: "999px", zIndex: 10, pointerEvents: "none", whiteSpace: "nowrap" }}>
            ⚠ 演示分区：未获取到本次测量的真实分区数据（请检查 Python 后端是否正常）
          </span>
        </div>
      )}

      {/* 压力/面积：分区标签 + 区界虚线（同视角，纯数据可视化展开，不旋转） */}
      {mode === "pressure" && settled && rects && geo && (
        <div className="anno-appear">
          {geo.left?.bounds.map((yL, i) => {
            const yR = geo.right?.bounds[i] ?? yL;
            const y = (yL + yR) / 2;
            return (
              <div
                key={`gz-${i}`}
                style={{ position: "absolute", top: `${y}%`, left: `${rects.left.rect.left - 6}%`, width: `${rects.right.rect.left + rects.right.rect.width + 6 - (rects.left.rect.left - 6)}%`, borderTop: "2px dashed #073BA3", zIndex: 9, pointerEvents: "none" }}
              />
            );
          })}
          {geo.left?.centers.map((y, zi) =>
            chip(zi, sections.left[zi]?.length ?? 0, rects.left.rect.left - 8, y, true, `cl-${zi}`),
          )}
          {geo.right?.centers.map((y, zi) =>
            chip(zi, sections.right[zi]?.length ?? 0, rects.right.rect.left + rects.right.rect.width + 8, y, false, `cr-${zi}`),
          )}
        </div>
      )}

      {/* 压力/面积：分区数据缺失回退演示时的显式提示（防止把假数据当真） */}
      {mode === "pressure" && settled && sections.isDemo && (
        <div className="anno-appear">
          <span style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", fontSize: "12px", fontWeight: 700, color: "#062d7b", background: "rgba(232,240,255,0.92)", border: "1px solid #0a44b8", padding: "4px 14px", borderRadius: "999px", zIndex: 10, pointerEvents: "none", whiteSpace: "nowrap" }}>
            演示分区示意 —— 本次测量未获取到真实分区数据，请确认 Python 分析服务在运行后重新测量
          </span>
        </div>
      )}

      {/* COP：底部图例（起点→终点说明），避免只有孤零零的绿/红点看不懂 */}
      {mode === "cop" && settled && hasCop && (
        <div className="anno-appear">
          <div style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "7px", fontSize: "11px", fontWeight: 600, color: "#2A457A", background: "rgba(255,255,255,0.7)", padding: "3px 12px", borderRadius: "999px", zIndex: 10, pointerEvents: "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
            起点
            <span style={{ width: 34, height: 3, borderRadius: 2, background: "linear-gradient(90deg,#16a34a,#ef4444)", display: "inline-block" }} />
            终点
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            <span style={{ marginLeft: 4, color: "#6a7ca0" }}>· COP 压力中心轨迹</span>
          </div>
        </div>
      )}

      {/* COP 占位示意（无真实 COP 数据时的兜底） */}
      {mode === "cop" && settled && !hasCop && (
        <div className="anno-appear">
          <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", fontSize: "13px", fontWeight: 700, color: "#40598A", background: "rgba(255,255,255,0.85)", padding: "6px 14px", borderRadius: "8px", zIndex: 5 }}>
            暂无 COP 数据（请完成一次测量 / 导入）
          </span>
        </div>
      )}
    </div>
  );
}

// ─── 视图2：2D 足底轮廓 + 四色区域划分 ────────────────────────────────────────
// 区域颜色定义（与设计图一致）
const ZONE_COLORS = {
  toe: { fill: "rgba(100,160,230,0.85)", label: "趾部", count: 38 },
  forefoot: { fill: "rgba(100,200,120,0.85)", label: "前足", count: 74 },
  midfoot: { fill: "rgba(245,190,60,0.85)", label: "中足", count: 57 },
  heel: { fill: "rgba(220,80,120,0.85)", label: "后足", count: 64 },
};

// 足底轮廓（归一化 0~1，脚趾朝上）
const FOOT_OUTLINE = [
  [0.32, 0.02], [0.42, 0.00], [0.52, 0.00], [0.62, 0.02],
  [0.70, 0.06], [0.76, 0.12], [0.80, 0.20], [0.80, 0.30],
  [0.78, 0.38], [0.82, 0.46], [0.82, 0.54], [0.80, 0.62],
  [0.76, 0.70], [0.70, 0.76], [0.64, 0.82], [0.60, 0.88],
  [0.58, 0.94], [0.56, 1.00],
  [0.44, 1.00], [0.42, 0.94], [0.40, 0.88],
  [0.36, 0.82], [0.30, 0.76], [0.24, 0.70],
  [0.18, 0.62], [0.18, 0.54], [0.20, 0.46],
  [0.24, 0.38], [0.20, 0.30], [0.20, 0.20],
  [0.24, 0.12], [0.28, 0.06],
];

// 区域边界（y 归一化）
const ZONE_BOUNDS = {
  toe: [0.0, 0.28],
  forefoot: [0.28, 0.50],
  midfoot: [0.50, 0.72],
  heel: [0.72, 1.0],
};

function getZone(ny: number): keyof typeof ZONE_COLORS {
  if (ny < ZONE_BOUNDS.toe[1]) return "toe";
  if (ny < ZONE_BOUNDS.forefoot[1]) return "forefoot";
  if (ny < ZONE_BOUNDS.midfoot[1]) return "midfoot";
  return "heel";
}

function isInFootOutline(px: number, py: number): boolean {
  let inside = false;
  const n = FOOT_OUTLINE.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = FOOT_OUTLINE[i][0], yi = FOOT_OUTLINE[i][1];
    const xj = FOOT_OUTLINE[j][0], yj = FOOT_OUTLINE[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function FootHeatmapZone({ label, color, count, side }: { label: string; color: string; count: number; side: "left" | "right" }) {
  const isLeft = side === "left";
  return (
    <div style={{
      position: "absolute",
      [isLeft ? "left" : "right"]: "-80px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      whiteSpace: "nowrap",
    }}>
      {isLeft ? (
        <>
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#101E3A", background: color.replace("0.85", "0.2"), padding: "3px 8px", borderRadius: "6px", border: `1px solid ${color}` }}>
            {label}({count})
          </span>
          <div style={{ width: "24px", height: "1px", background: "rgba(26,47,90,0.3)" }} />
        </>
      ) : (
        <>
          <div style={{ width: "24px", height: "1px", background: "rgba(26,47,90,0.3)" }} />
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#101E3A", background: color.replace("0.85", "0.2"), padding: "3px 8px", borderRadius: "6px", border: `1px solid ${color}` }}>
            {label}({count})
          </span>
        </>
      )}
    </div>
  );
}

function SingleFootZoneCanvas({ side }: { side: "left" | "right" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const COLS = 20;
    const ROWS = 28;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    // 绘制区域色块
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const nx = (col + 0.5) / COLS;
        const ny = (row + 0.5) / ROWS;

        if (!isInFootOutline(nx, ny)) continue;

        const zone = getZone(ny);
        const color = ZONE_COLORS[zone].fill;

        // 解析 rgba
        const match = color.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
        if (match) {
          ctx.fillStyle = `rgba(${match[1]},${match[2]},${match[3]},${match[4]})`;
        }
        ctx.fillRect(col * cellW + 0.5, row * cellH + 0.5, cellW - 1, cellH - 1);
      }
    }

    // 绘制足底轮廓
    ctx.beginPath();
    FOOT_OUTLINE.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * W, y * H);
      else ctx.lineTo(x * W, y * H);
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(26,47,90,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 绘制区域分界线（虚线）
    const boundaries = [ZONE_BOUNDS.toe[1], ZONE_BOUNDS.forefoot[1], ZONE_BOUNDS.midfoot[1]];
    boundaries.forEach(yNorm => {
      const y = yNorm * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.strokeStyle = "rgba(7,59,163,0.6)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }, []);

  useEffect(() => { draw(); }, [draw]);

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={120}
        height={200}
        style={{ borderRadius: "8px", display: "block" }}
      />
      {/* 区域标签（左脚在左侧，右脚在右侧） */}
      {(Object.entries(ZONE_COLORS) as [keyof typeof ZONE_COLORS, typeof ZONE_COLORS[keyof typeof ZONE_COLORS]][]).map(([zone, info]) => {
        const midY = ((ZONE_BOUNDS[zone][0] + ZONE_BOUNDS[zone][1]) / 2) * 200;
        return (
          <div key={zone} style={{
            position: "absolute",
            top: midY,
            transform: "translateY(-50%)",
            [side === "left" ? "right" : "left"]: "100%",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            whiteSpace: "nowrap",
            paddingLeft: side === "right" ? "6px" : "0",
            paddingRight: side === "left" ? "6px" : "0",
          }}>
            {side === "left" ? (
              <>
                <div style={{ width: "20px", height: "1px", background: "rgba(26,47,90,0.3)" }} />
                <span style={{
                  fontSize: "11px", fontWeight: "600", color: "#101E3A",
                  background: info.fill.replace("0.85", "0.15"),
                  padding: "2px 6px", borderRadius: "5px",
                  border: `1px solid ${info.fill}`,
                }}>
                  {info.label}({info.count})
                </span>
              </>
            ) : (
              <>
                <span style={{
                  fontSize: "11px", fontWeight: "600", color: "#101E3A",
                  background: info.fill.replace("0.85", "0.15"),
                  padding: "2px 6px", borderRadius: "5px",
                  border: `1px solid ${info.fill}`,
                }}>
                  {info.label}({info.count})
                </span>
                <div style={{ width: "20px", height: "1px", background: "rgba(26,47,90,0.3)" }} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 视图3：压力/面积分析（3D 脚模 + Python 足弓分区色块贴敷） ────────────────
const ZONE_META = [
  { label: "趾部", color: "#5B8FF9", bg: "#EAF2FF" },
  { label: "前足", color: "#3FAE5F", bg: "#EAF9EF" },
  { label: "中足", color: "#D89B14", bg: "#FDF5E2" },
  { label: "后足", color: "#D6336C", bg: "#FDEAF1" },
];
// 格子色（设计稿取色）：趾部蓝紫 / 前足草绿 / 中足金黄 / 后足玫红
const ZONE_CELL_COLORS = ["#7B96F0", "#5EC878", "#F6BC3F", "#DF567F"];

/** Python section_coords 可能是数组或对象，统一为 [区][点][r,c] */
function normalizeSectionCoords(sc: unknown): ZoneSections {
  if (!sc) return [];
  if (Array.isArray(sc)) return sc as ZoneSections;
  const obj = sc as Record<string, number[][]>;
  return Object.keys(obj)
    .sort()
    .map((k) => obj[k]);
}

/**
 * 演示分区（无 Python 数据时兜底）：参数化脚形，按设计稿密度 30 行 × 12 列生成。
 * 形状特征：趾尖/脚跟圆弧收尾、前掌最宽、中足内侧凹（足弓）——脚跟不会出现斜切缺口。
 */
const DEMO_ROWS = 30;
const DEMO_COLS = 12;
function demoFootProfile(t: number): { cx: number; hw: number } {
  // t = r/(rows-1)，0=趾尖 1=脚跟末端；cx=中心列，hw=半宽（格）
  let hw: number;
  if (t < 0.15) {
    const u = t / 0.15; // 趾尖圆弧
    hw = 1.6 + 2.9 * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)));
  } else if (t < 0.38) {
    hw = 4.5; // 前掌最宽
  } else if (t < 0.72) {
    const u = (t - 0.38) / 0.34; // 中足收窄（贴合脚模的细腰轮廓）
    hw = 4.5 - 1.5 * Math.sin((u * Math.PI) / 2);
  } else if (t < 0.85) {
    const u = (t - 0.72) / 0.13; // 跟部略回宽
    hw = 3.0 + 0.8 * u;
  } else {
    const u = (t - 0.85) / 0.15; // 脚跟圆弧收尾
    hw = 3.8 * Math.sqrt(Math.max(0, 1 - u * u));
  }
  // 中足段中心向外侧偏（内侧=足弓凹陷；左脚内侧在右）
  let cx = DEMO_COLS / 2;
  if (t >= 0.4 && t < 0.75) {
    cx -= 0.9 * Math.sin(((t - 0.4) / 0.35) * Math.PI);
  }
  return { cx, hw };
}

function demoSections(mirror: boolean): ZoneSections {
  const secs: ZoneSections = [[], [], [], []];
  for (let r = 0; r < DEMO_ROWS; r++) {
    const { cx, hw } = demoFootProfile(r / (DEMO_ROWS - 1));
    // 分区 3:4:4:4 → 6/8/8/8 行
    const zi = r < 6 ? 0 : r < 14 ? 1 : r < 22 ? 2 : 3;
    for (let c = 0; c < DEMO_COLS; c++) {
      const cc = mirror ? DEMO_COLS - 1 - c : c;
      if (Math.abs(c + 0.5 - cx) < hw) secs[zi].push([r, cc]);
    }
  }
  return secs;
}

/** 单只脚格子覆盖层的绘制几何（px 坐标 + 百分比标注位） */
interface FootZoneGeo {
  eqB: ZoneBounds;
  scale: number; // 单格边长 px（左右脚统一）
  x0: number; // 格子簇左上角 px
  y0: number;
  centers: number[]; // 四区标签中心 y%
  bounds: number[]; // 三条分界线 y%
}


function View2DZones() {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: "400px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "20px",
    }}>
      <div style={{ fontSize: "13px", fontWeight: "600", color: "#1A2F5A" }}>
        足底区域划分 · 趾部 / 前足 / 中足 / 后足
      </div>

      {/* 两脚并排 */}
      <div style={{ display: "flex", gap: "80px", alignItems: "center" }}>
        <SingleFootZoneCanvas side="left" />
        <SingleFootZoneCanvas side="right" />
      </div>

      {/* 图例 */}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        {(Object.entries(ZONE_COLORS) as [string, typeof ZONE_COLORS[keyof typeof ZONE_COLORS]][]).map(([, info]) => (
          <div key={info.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: info.fill }} />
            <span style={{ fontSize: "11px", color: "#1A2F5A" }}>{info.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}



// ─── 右侧报告面板（按设计稿：白卡 + 橙竖条标题 + 双模式压力/面积） ────────────
/** 演示数据（后续接 Python /analyze 的真实结果） */
const REPORT_DATA = {
  dims: { leftLen: 270, rightLen: 272, leftWid: 183, rightWid: 180 },
  arch: {
    left: { index: 0.272, type: "扁平足", mli: 0.89, risk: "足内翻风险", riskColor: "#ff5a2c" },
    right: { index: 0.285, type: "扁平足", mli: 1.02, risk: "正常受力", riskColor: "#2fb56b" },
  },
  // 顶部"报告分析总结"卡的演示兜底（真实测量时由 buildReportData 以同源数据覆盖）
  summary: {
    archLType: "扁平足",
    archLIndex: 0.272,
    archRType: "扁平足",
    archRIndex: 0.272,
    copLen: "126.3mm",
    copNote: "平衡控制良好",
  },
  pressure: {
    leftTotal: 15773,
    rightTotal: 15773,
    zonesPct: { fore: 46, mid: 36, hind: 46 },
    zonesPctR: { fore: 46, mid: 46, hind: 46 },
    leftRatio: 65,
  },
  area: {
    leftTotal: 15773,
    rightTotal: 15773,
    zones: { fore: 106, mid: 106, hind: 106 },
    zonesR: { fore: 106, mid: 106, hind: 106 },
    bothTotal: 15773,
    diff: 7.4,
  },
  cop: [
    { label: "轨迹长度", value: "126.28", unit: "mm", icon: "cop-track-length" },
    { label: "活动总面积", value: "7.74", unit: "mm²", icon: "cop-active-area" },
    { label: "最大摆幅", value: "0.94", unit: "mm", icon: "cop-max-sway" },
    { label: "稳定摆幅", value: "0.04", unit: "mm", icon: "cop-stable-sway" },
    { label: "最大离心", value: "0.71", unit: "mm", icon: "cop-max-eccentric" },
    { label: "偏移平衡速度", value: "12.96", unit: "mm/s", icon: "cop-drift-speed" },
    { label: "前后方向标准差", value: "4.72", unit: "mm", icon: "cop-std-ap" },
    { label: "左右方向标准差", value: "0.21", unit: "mm", icon: "cop-std-ml" },
  ],
};

type ReportData = typeof REPORT_DATA;

/**
 * 把一次测量的真实分析结果映射成报告数据；任何缺失字段回退演示值。
 * 数据源：Python /analyze（尺寸/足弓/分区/COP）+ 前端补充（MLI、左右分压分面积）。
 */
function buildReportData(a: MeasureAnalysis | null): ReportData {
  const base = REPORT_DATA;
  if (!a) return base;
  const d = a.python?.success ? a.python.data : null;
  const ad = d?.additional_data;
  const cop = d?.cop_time_series;
  const arch = d?.arch_features;
  const fe = a.frontend;

  const mkArch = (side: "left" | "right") => {
    const f = side === "left" ? arch?.left_foot : arch?.right_foot;
    const mli = a.mli[side];
    let { risk, riskColor } = base.arch[side];
    if (mli != null) {
      if (mli < 0.9) {
        risk = "足内翻风险";
        riskColor = "#ff5a2c";
      } else if (mli > 1.1) {
        risk = "足外翻风险";
        riskColor = "#ff5a2c";
      } else {
        // MLI 正常区间的标签叫"正常受力"（不叫"正常足弓"——足弓分型是旁边
        // 另一个维度的结论，两处叫法要区分开；与 aciki-plantar-pressure 参考项目一致）
        risk = "正常受力";
        riskColor = "#2fb56b";
      }
    }
    return {
      index: f?.area_index ?? base.arch[side].index,
      type: f?.area_type ?? base.arch[side].type,
      mli: mli ?? base.arch[side].mli,
      risk,
      riskColor,
    };
  };

  const pct = (rec: Record<string, number> | undefined, key: string, fb: number) =>
    rec?.[key] != null ? Math.round(rec[key] * 100) : fb;
  const zone = (arr: number[] | undefined, i: number, fb: number) =>
    arr?.[i] != null ? Math.round(arr[i]) : fb;

  const lp = fe?.leftPressure ?? base.pressure.leftTotal;
  const rp = fe?.rightPressure ?? base.pressure.rightTotal;
  const la = ad ? Math.round(ad.left_area.total_area_cm2) : fe?.leftArea ?? base.area.leftTotal;
  const ra = ad ? Math.round(ad.right_area.total_area_cm2) : fe?.rightArea ?? base.area.rightTotal;

  return {
    dims: {
      // Python 的 left_length/width 单位是 cm（(格数)×0.7cm + 1.5，垫子点间距 7mm），
      // 前端展示单位 mm → ×10 换算（曾直接当 mm 显示导致"足长 26mm"）
      leftLen: ad ? Math.round(ad.left_length * 10) : base.dims.leftLen,
      rightLen: ad ? Math.round(ad.right_length * 10) : base.dims.rightLen,
      leftWid: ad ? Math.round(ad.left_width * 10) : base.dims.leftWid,
      rightWid: ad ? Math.round(ad.right_width * 10) : base.dims.rightWid,
    },
    arch: { left: mkArch("left"), right: mkArch("right") },
    pressure: {
      leftTotal: lp,
      rightTotal: rp,
      zonesPct: {
        fore: pct(ad?.left_pressure, "前足", base.pressure.zonesPct.fore),
        mid: pct(ad?.left_pressure, "中足", base.pressure.zonesPct.mid),
        hind: pct(ad?.left_pressure, "后足", base.pressure.zonesPct.hind),
      },
      zonesPctR: {
        fore: pct(ad?.right_pressure, "前足", base.pressure.zonesPctR.fore),
        mid: pct(ad?.right_pressure, "中足", base.pressure.zonesPctR.mid),
        hind: pct(ad?.right_pressure, "后足", base.pressure.zonesPctR.hind),
      },
      leftRatio: lp + rp > 0 ? Math.round((lp / (lp + rp)) * 100) : base.pressure.leftRatio,
    },
    area: {
      leftTotal: la,
      rightTotal: ra,
      zones: {
        fore: zone(ad?.left_area.area_cm2, 0, base.area.zones.fore),
        mid: zone(ad?.left_area.area_cm2, 1, base.area.zones.mid),
        hind: zone(ad?.left_area.area_cm2, 2, base.area.zones.hind),
      },
      zonesR: {
        fore: zone(ad?.right_area.area_cm2, 0, base.area.zonesR.fore),
        mid: zone(ad?.right_area.area_cm2, 1, base.area.zonesR.mid),
        hind: zone(ad?.right_area.area_cm2, 2, base.area.zonesR.hind),
      },
      bothTotal: la + ra,
      diff: Math.round(Math.abs(la - ra) * 10) / 10,
    },
    // 顶部"报告分析总结"卡：与右侧报告数据同源（曾硬编码演示值导致两边对不上）
    summary: {
      archLType: (arch?.left_foot?.area_type ?? base.arch.left.type).replace(/\s*[（(].*$/, ""),
      archLIndex: arch?.left_foot?.area_index ?? base.arch.left.index,
      archRType: (arch?.right_foot?.area_type ?? base.arch.right.type).replace(/\s*[（(].*$/, ""),
      archRIndex: arch?.right_foot?.area_index ?? base.arch.right.index,
      copLen: cop ? `${cop.path_length.toFixed(1)}mm` : "—",
      // 平衡评价（展示文案，阈值可按需调整）：静态站立 COP 轨迹越短平衡控制越稳
      copNote: cop ? (cop.path_length <= 500 ? "平衡控制良好" : "平衡波动较大") : "",
    },
    cop: cop
      ? [
          { label: "轨迹长度", value: cop.path_length.toFixed(2), unit: "mm", icon: "cop-track-length" },
          { label: "活动总面积", value: cop.contact_area.toFixed(2), unit: "mm²", icon: "cop-active-area" },
          { label: "最大摆幅", value: cop.major_axis.toFixed(2), unit: "mm", icon: "cop-max-sway" },
          { label: "稳定摆幅", value: cop.minor_axis.toFixed(2), unit: "mm", icon: "cop-stable-sway" },
          { label: "最大离心", value: cop.max_displacement.toFixed(2), unit: "mm", icon: "cop-max-eccentric" },
          { label: "偏移平衡速度", value: cop.avg_velocity.toFixed(2), unit: "mm/s", icon: "cop-drift-speed" },
          { label: "前后方向标准差", value: cop.std_x.toFixed(2), unit: "mm", icon: "cop-std-ap" },
          { label: "左右方向标准差", value: cop.std_y.toFixed(2), unit: "mm", icon: "cop-std-ml" },
        ]
      : base.cop,
  };
}

// ─── 右侧报告面板（重设计：浅色面板 / 无嵌套卡片 / 左右脚双栏对照 / Inter 数字）──
// 与采集页 HUD 同一套语言：左侧细竖条作节标识，中文标题 + 字距拉开的英文小标，
// 数值统一用 Inter 等宽数字。选中节 = 白底浮起 + 竖条变品牌蓝。
const RP = {
  brand: "#00359B",
  ink: "#17191C",
  muted: "#7C89A6",
  rule: "rgba(0,53,155,0.12)",
  num: '"Inter", "Helvetica Neue", Arial, sans-serif',
};

/** 等宽数字 + 小单位 */
function Num({ v, unit, size = 22 }: { v: string | number; unit?: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "3px", whiteSpace: "nowrap" }}>
      <span
        style={{
          fontFamily: RP.num,
          fontSize: `${size}px`,
          fontWeight: 700,
          lineHeight: 1,
          color: RP.ink,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {v}
      </span>
      {unit && (
        <span style={{ fontFamily: RP.num, fontSize: `${Math.max(10, Math.round(size * 0.5))}px`, fontWeight: 500, color: RP.muted }}>
          {unit}
        </span>
      )}
    </span>
  );
}

/** 左/右脚列头：中文 + 字距英文 */
function SideLabel({ side }: { side: "left" | "right" }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "8px" }}>
      <span style={{ fontSize: "12px", fontWeight: 700, color: RP.ink }}>{side === "left" ? "左脚" : "右脚"}</span>
      <span style={{ fontFamily: RP.num, fontSize: "9px", fontWeight: 600, letterSpacing: "0.22em", color: RP.muted }}>
        {side === "left" ? "LEFT" : "RIGHT"}
      </span>
    </div>
  );
}

/** 一个可点选的报告节：标题行 + 内容；点击驱动左侧舞台视角 */
function PanelSection({
  id,
  active,
  onSelect,
  zh,
  en,
  right,
  children,
}: {
  id: ReportView;
  active: ReportView;
  onSelect: (v: ReportView) => void;
  zh: string;
  en: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`rp-section${active === id ? " is-active" : ""}`} onClick={() => onSelect(id)}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0, flex: "1 1 auto" }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: RP.ink, whiteSpace: "nowrap" }}>{zh}</span>
          {/* 英文小标宽度不够时截成省略号，不能撞到右侧的开关 */}
          <span style={{ fontFamily: RP.num, fontSize: "9px", fontWeight: 600, letterSpacing: "0.22em", textTransform: "uppercase", color: RP.muted, whiteSpace: "nowrap", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {en}
          </span>
        </div>
        {right}
      </header>
      {/* 内容区吃掉标题以下的全部高度，各节内部再把行距铺开——四节等高后不留大块空白 */}
      <div className="rp-body">{children}</div>
    </section>
  );
}

/** 双栏对照容器：左右两列，中间一条细分隔线。撑满父级剩余高度，两列各自纵向铺开 */
function TwoCols({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1px 1fr", gap: "0 16px", alignItems: "stretch" }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>{left}</div>
      <div style={{ alignSelf: "stretch", background: RP.rule }} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>{right}</div>
    </div>
  );
}

/** 分区占比迷你条：标签 / 条 / 数值 */
function ZoneBar({ label, ratio, value, color }: { label: string; ratio: number; value: string; color: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "11px", color: RP.muted, whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ height: "5px", borderRadius: "999px", background: "rgba(0,53,155,0.08)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%`, height: "100%", borderRadius: "999px", background: color, transition: "width 260ms cubic-bezier(0.23,1,0.32,1)" }} />
      </div>
      <span style={{ fontFamily: RP.num, fontSize: "12px", fontWeight: 700, color: RP.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: "40px", textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

/** 单脚足弓栏 */
function ArchCol({ side, data }: { side: "left" | "right"; data: typeof REPORT_DATA.arch.left }) {
  // 大号足弓类型只显示中文短语（去掉"(flat foot)"这类英文括注）
  const shortType = data.type.replace(/\s*[（(].*$/, "");
  const icon = data.risk.includes("内翻") ? "arch-varus" : data.risk.includes("外翻") ? "arch-valgus" : "arch-normal";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <SideLabel side={side} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontSize: "26px", fontWeight: 700, color: RP.ink, lineHeight: 1, whiteSpace: "nowrap" }}>{shortType}</div>
        <img src={RICON(icon)} alt="" style={{ width: "36px", height: "36px", flexShrink: 0, opacity: 0.9 }} />
      </div>
      {/* 列宽不够时两项换行，而不是压过分隔线盖到邻列 */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px", marginTop: "10px", fontSize: "12px", color: RP.muted }}>
        <span style={{ whiteSpace: "nowrap" }}>
          足弓指数 <b style={{ fontFamily: RP.num, color: RP.ink, fontWeight: 700 }}>{data.index.toFixed(3)}</b>
        </span>
        <span style={{ whiteSpace: "nowrap" }}>
          MLI <b style={{ fontFamily: RP.num, color: RP.ink, fontWeight: 700 }}>{data.mli.toFixed(2)}</b>
        </span>
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "8px", fontSize: "12px", fontWeight: 700, color: data.riskColor }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: data.riskColor }} />
        {data.risk}
      </div>
    </div>
  );
}

type ReportView = "dims" | "arch" | "pressure" | "cop";

// 分区条用色（与左侧舞台分区色块同源：前足草绿 / 中足金黄 / 后足玫红）
const ZONE_BAR_COLORS = { fore: "#5EC878", mid: "#F6BC3F", hind: "#DF567F" };

function ReportPanel({
  onNext,
  active,
  onSelect,
  data,
}: {
  onNext: () => void;
  active: ReportView;
  onSelect: (v: ReportView) => void;
  data: ReportData;
}) {
  // 压力 / 面积 双模式互切
  const [mode, setMode] = useState<"pressure" | "area">("pressure");
  const P = data;

  const zonesOf = (side: "left" | "right") => {
    if (mode === "pressure") {
      const z = side === "left" ? P.pressure.zonesPct : P.pressure.zonesPctR;
      return [
        { key: "fore", label: "前足", ratio: z.fore / 100, value: `${z.fore}%` },
        { key: "mid", label: "中足", ratio: z.mid / 100, value: `${z.mid}%` },
        { key: "hind", label: "后足", ratio: z.hind / 100, value: `${z.hind}%` },
      ] as const;
    }
    const z = side === "left" ? P.area.zones : P.area.zonesR;
    // 面积模式按双脚各区最大值归一，条长可横向比较
    const max = Math.max(1, ...Object.values(P.area.zones), ...Object.values(P.area.zonesR));
    return [
      { key: "fore", label: "前足", ratio: z.fore / max, value: `${z.fore}cm²` },
      { key: "mid", label: "中足", ratio: z.mid / max, value: `${z.mid}cm²` },
      { key: "hind", label: "后足", ratio: z.hind / max, value: `${z.hind}cm²` },
    ] as const;
  };

  const footCol = (side: "left" | "right") => {
    const total = side === "left" ? (mode === "pressure" ? P.pressure.leftTotal : P.area.leftTotal) : mode === "pressure" ? P.pressure.rightTotal : P.area.rightTotal;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <SideLabel side={side} />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
          <span style={{ fontSize: "11px", color: RP.muted, whiteSpace: "nowrap" }}>总{mode === "pressure" ? "压力" : "面积"}</span>
          <Num v={total} unit={mode === "pressure" ? "pa" : "cm²"} size={20} />
        </div>
        {/* 三条分区条在剩余高度里均匀铺开 */}
        <div style={{ flex: 1, display: "grid", gap: "7px", alignContent: "space-evenly" }}>
          {zonesOf(side).map((z) => (
            <ZoneBar key={z.key} label={z.label} ratio={z.ratio} value={z.value} color={ZONE_BAR_COLORS[z.key]} />
          ))}
        </div>
      </div>
    );
  };

  const leftRatio = P.pressure.leftRatio;

  return (
    <div className="rp-panel">
      {/* 面板标题行 */}
      <div className="rp-panel-head">
        <div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: RP.ink, lineHeight: 1.1 }}>用户测量报告</div>
          <div style={{ fontFamily: RP.num, fontSize: "9px", fontWeight: 600, letterSpacing: "0.26em", color: RP.muted, marginTop: "5px" }}>
            MEASUREMENT REPORT
          </div>
        </div>
        <button onClick={onNext} className="rp-next">
          查看解决方案
          <span aria-hidden="true" style={{ fontFamily: RP.num, marginLeft: "6px" }}>→</span>
        </button>
      </div>

      {/* 四节横排：脚模在上，数据在下 */}
      <div className="rp-grid">
      {/* 足底尺寸：3 列表格（项目 / 左 / 右） */}
      <PanelSection id="dims" active={active} onSelect={onSelect} zh="足底尺寸" en="Foot Dimensions">
        {/* 表头一行贴顶，足长/足宽两行平分剩余高度并在行内垂直居中 → 表格铺满整节 */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "44px 1fr 1fr", gridTemplateRows: "auto 1fr 1fr", columnGap: "12px", alignItems: "center" }}>
          <span />
          <SideLabel side="left" />
          <SideLabel side="right" />
          <span style={{ fontSize: "12px", color: RP.muted }}>足长</span>
          <Num v={P.dims.leftLen} unit="mm" size={28} />
          <Num v={P.dims.rightLen} unit="mm" size={28} />
          <span style={{ fontSize: "12px", color: RP.muted }}>足宽</span>
          <Num v={P.dims.leftWid} unit="mm" size={28} />
          <Num v={P.dims.rightWid} unit="mm" size={28} />
        </div>
      </PanelSection>

      {/* 足弓分析：左右双栏 */}
      <PanelSection id="arch" active={active} onSelect={onSelect} zh="足弓分析" en="Foot Arch Analysis">
        <TwoCols left={<ArchCol side="left" data={P.arch.left} />} right={<ArchCol side="right" data={P.arch.right} />} />
      </PanelSection>

      {/* 压力 / 面积：分段开关切换，双栏 + 分区迷你条 + 左右平衡条 */}
      <PanelSection
        id="pressure"
        active={active}
        onSelect={onSelect}
        zh={mode === "pressure" ? "压力分析" : "面积分析"}
        en={mode === "pressure" ? "Pressure Distribution" : "Contact Area"}
        right={
          <div className="rp-seg" role="tablist" aria-label="压力 / 面积">
            {(["pressure", "area"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={`rp-seg-btn${mode === m ? " is-on" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode(m);
                  onSelect("pressure");
                }}
              >
                {m === "pressure" ? "压力" : "面积"}
              </button>
            ))}
          </div>
        }
      >
        <TwoCols left={footCol("left")} right={footCol("right")} />

        <div style={{ borderTop: `1px solid ${RP.rule}`, marginTop: "12px", paddingTop: "10px" }}>
          {mode === "pressure" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
                <span style={{ fontSize: "11px", color: RP.muted }}>
                  左右压力比 <b style={{ fontFamily: RP.num, color: RP.ink }}>{leftRatio}</b> : <b style={{ fontFamily: RP.num, color: RP.ink }}>{100 - leftRatio}</b>
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: Math.abs(leftRatio - 50) <= 5 ? "#2fb56b" : "#ff5a2c" }}>
                  {Math.abs(leftRatio - 50) <= 5 ? "分布均衡" : `偏向${leftRatio > 50 ? "左" : "右"}脚`}
                </span>
              </div>
              {/* 双向平衡条：中央 50% 刻度，左侧品牌蓝、右侧浅蓝 */}
              <div style={{ position: "relative", height: "8px", borderRadius: "999px", background: "rgba(0,53,155,0.14)", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${leftRatio}%`, background: RP.brand, transition: "width 300ms cubic-bezier(0.23,1,0.32,1)" }} />
                <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "2px", marginLeft: "-1px", background: "#fff" }} />
              </div>
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "16px" }}>
              <span style={{ fontSize: "11px", color: RP.muted, display: "flex", alignItems: "baseline", gap: "8px" }}>
                双脚总面积 <Num v={P.area.bothTotal} unit="cm²" size={16} />
              </span>
              <span style={{ fontSize: "11px", color: RP.muted, display: "flex", alignItems: "baseline", gap: "8px" }}>
                左右差异 <Num v={P.area.diff} unit="cm²" size={16} />
              </span>
            </div>
          )}
        </div>
      </PanelSection>

      {/* COP 平衡指标：两列定义表，每行 标签 …… 数值 */}
      <PanelSection id="cop" active={active} onSelect={onSelect} zh="COP 平衡指标" en="Center of Pressure">
        {/* 4 行等分剩余高度，每行内容垂直居中；分隔线随行距一起铺开 */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "1fr", columnGap: "18px", rowGap: "0" }}>
          {P.cop.map((c, i) => (
            <div
              key={c.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px",
                borderTop: i < 2 ? "none" : `1px solid ${RP.rule}`,
              }}
            >
              <span style={{ fontSize: "12px", color: RP.muted, whiteSpace: "nowrap" }}>{c.label}</span>
              <Num v={c.value} unit={c.unit} size={16} />
            </div>
          ))}
        </div>
      </PanelSection>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function ReportPage({
  onNext,
  onEnd,
  onBack,
  onHistory,
}: {
  onNext: () => void;
  /** 结束体验：清当前用户并直接回首页（不是流程下一步） */
  onEnd: () => void;
  onBack: () => void;
  /** 右上角常驻「体验记录」入口 */
  onHistory?: () => void;
  /** 步骤导航已移除，保留该 prop 仅为兼容调用方 */
  onStepBack?: (step: number) => void;
}) {
  const { currentUser, analysis } = useApp();
  // 真实测量分析结果 → 报告数据（Python 缺席时逐字段回退演示值）
  const reportData = useMemo(() => buildReportData(analysis), [analysis]);
  // 四个固定视角，由下方报告节点击驱动（足底尺寸/足弓分析/压力面积/COP）
  // 开发调试：URL 加 ?panel=pressure|arch|cop|dims 可直达对应视图
  const [viewMode, setViewMode] = useState<ReportView>(() => {
    const p = new URLSearchParams(window.location.search).get("panel");
    return ["dims", "arch", "pressure", "cop"].includes(p ?? "") ? (p as ReportView) : "dims";
  });

  return (
    <div className="report-shell">
      {/* 顶栏：左品牌标识 + 右「体验记录」入口（与采集页一致），不再显示步骤导航 */}
      <header className="report-topbar">
        <BrandLogo size={52} />
        <HistoryLink onClick={onHistory} />
      </header>

      <main className="report-main">
        {/* 上：脚模舞台。四模式共用同一常驻脚模，尺寸/压力面积/COP 为俯视（互切不旋转，
            仅换叠加层）；足弓分析为站姿（进/出时旋转过渡）。舞台高度与采集页脚模区一致。 */}
        <section className="report-stage">
          <FootStage dims={reportData.dims} arch={reportData.arch} mode={viewMode} />
        </section>

        {/* 下：报告数据面板（四节横排，点击切换上方脚模视角） */}
        <section className="report-dash">
          <ReportPanel onNext={onNext} active={viewMode} onSelect={setViewMode} data={reportData} />
        </section>

        {/* 底部信息栏（融入背景，无填充） */}
        <div className="report-footer">
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#3d3d3d" }}>
            当前用户：{currentUser?.name ?? "—"}（ID:{currentUser ? formatUserId(currentUser.id) : "—"}）
          </span>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#3d3d3d", fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "4px" }}>
            重新测量
          </button>
          <button onClick={onEnd} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#00359f", fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "4px" }}>
            结束体验
          </button>
          <span style={{ fontSize: "14px", color: "#a6afc0", fontWeight: 700 }}>下载文件</span>
        </div>
      </main>

      <style>{`
        .report-shell {
          /* 常规屏一屏放完：顶栏 / 脚模舞台（弹性）/ 数据面板 / 底栏 竖排，舞台吃掉剩余高度。
             矮屏放不下时舞台收到最小高度后整页纵向滚动——不能 overflow:hidden 把内容裁掉 */
          --report-pad-x: clamp(28px, 4.2vw, 78px);
          --report-topbar-h: clamp(72px, 9vh, 96px);
          position: relative;
          /* 100% 而非 100vw：自身出竖向滚动条时 100vw 会多出一条滚动条宽度的横向溢出 */
          width: 100%;
          height: 100vh;
          /* 两向都允许滚动：窄窗口 / 高倍缩放下内容真装不下时给横向滚动条，绝不裁掉 */
          overflow: auto;
          /* 顶部淡蓝 → 向下渐白的干净背景（透视网格已统一取消） */
          background: linear-gradient(180deg, #EEF4FF 0%, #FFFFFF 57.5%, #FFFFFF 100%);
          isolation: isolate;
          font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
          color: #1f1f1f;
        }
        .report-topbar {
          /* absolute（相对 .report-shell 这个滚动容器）：矮屏整页滚动时顶栏随内容一起滚走，
             不会像 fixed 那样透明地压在滚上来的脚模标注上 */
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: var(--report-topbar-h);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--report-pad-x);
          z-index: 10;
        }
        /*
         * grid 而非 flex：三行 = 舞台(minmax(260px,1fr)) / 数据面板(auto) / 底栏(auto)。
         * 用 min-height 让内容超出一屏时随内容撑高、由 .report-shell 滚动；
         * 但 flex 容器只有 min-height 时子项高度"不确定"，舞台里 height:100% 的画布容器会塌成 150px。
         * grid 的网格区域在布局后一律视为确定尺寸，百分比高度能正常解析——所以这里必须是 grid。
         */
        .report-main {
          position: relative;
          z-index: 1;
          display: grid;
          /* 列轨道必须显式 minmax(0,1fr)：默认的 auto 列会把 3D 画布的像素缓冲宽度（CSS 宽 × dpr）
             当成最小内容宽度，浏览器放大到 150% 时整页被撑到 1.5 倍宽、内容被推出视口 */
          grid-template-columns: minmax(0, 1fr);
          /* 舞台下限 300：再矮双脚模型和尺寸标注挤在一起；矮屏宁可整页多滚一点 */
          grid-template-rows: minmax(300px, 1fr) auto auto;
          min-height: 100%;
          padding-top: var(--report-topbar-h);
        }
        /* 脚模舞台：占满顶栏与数据面板之间的剩余高度（脚模随之缩放）；左右内缩量与采集页 .measure-model 相同 */
        .report-stage {
          position: relative;
          min-height: 0;
          min-width: 0;
          margin: 0 calc(var(--report-pad-x) + clamp(150px, 11vw, 200px));
        }
        /* 底栏高度与方案页 BottomBar 同为 56px，三页底部信息行对齐 */
        .report-footer {
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 28px;
          padding: 0 var(--report-pad-x);
        }
        /* 标注在 pose 过渡完成后慢慢展开。
           必须撑满舞台（absolute inset:0）：动画的 transform 会让本层成为
           absolute 子元素的定位基准，若不撑满标注会全部挤到底部 */
        .anno-appear {
          position: absolute;
          inset: 0;
          pointer-events: none;
          /* 动画 transform 会创建 stacking context，必须显式高于 Canvas(z=1)，
             否则橙点/尺寸线会被脚模盖住 */
          z-index: 5;
          animation: anno-fade-in 350ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        /* 底衬专用：同样的展开动画，但保持在脚模（z=1）之下 */
        .anno-appear-under {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          animation: anno-fade-in 350ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @keyframes anno-fade-in {
          from { opacity: 0; transform: translateY(8px) scale(0.985); }
          to { opacity: 1; transform: none; }
        }
        /* 分区色块：随交互从中心向外展开（与标注同步淡入），不再"一打开就有" */
        .zone-grow {
          transform-origin: center center;
          animation: zone-grow-in 380ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @keyframes zone-grow-in {
          from { opacity: 0; transform: scale(0.7); }
          to { opacity: 1; transform: scale(1); }
        }
        /* 横向尺寸线：从左往右展开；纵向尺寸线：从上往下展开 */
        .anno-grow-h {
          transform-origin: left center;
          animation: anno-grow-x 450ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        .anno-grow-v {
          transform-origin: center top;
          animation: anno-grow-y 450ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }
        @keyframes anno-grow-x {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @keyframes anno-grow-y {
          from { transform: scaleY(0); }
          to { transform: scaleY(1); }
        }
        /* 数据面板：脚模下方整行铺开，靠顶部一条细分隔线与舞台区分 */
        .report-dash {
          border-top: 1px solid rgba(0,53,155,0.1);
          padding: 8px var(--report-pad-x) 0;
        }
        .rp-panel { width: 100%; display: flex; flex-direction: column; gap: 4px; }
        .rp-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 6px 2px 6px;
        }
        .rp-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          /* 四节等高：同一行统一拉到最高那节的高度，选中白卡的底边也就对齐 */
          align-items: stretch;
        }
        /* 1440 以下四列塞不下（压力卡的双栏分区条 + 英文小标 + 压力/面积开关），改 2×2；
           面板变高后舞台收到 minmax 下限、整页由 .report-shell 滚动 */
        @media (max-width: 1440px) {
          .rp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          /* 窄窗口下舞台两侧的留白按比例收窄，别把脚模挤成一条 */
          .report-stage { margin: 0 calc(var(--report-pad-x) + clamp(40px, 6vw, 120px)); }
        }
        /* 1100 以下（含浏览器高倍缩放）单列：压力卡的左右双栏 + 分区条在半宽里放不开 */
        @media (max-width: 1100px) {
          .rp-grid { grid-template-columns: minmax(0, 1fr); }
        }

        /* 报告节：默认无底，左侧细竖条；选中 = 白底浮起 + 竖条品牌蓝 */
        .rp-section {
          position: relative;
          display: flex;
          flex-direction: column;
          padding: 8px 12px 8px 16px;
          border-radius: 14px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background 180ms cubic-bezier(0.23,1,0.32,1), box-shadow 180ms cubic-bezier(0.23,1,0.32,1), border-color 180ms ease;
        }
        .rp-section::before {
          content: "";
          position: absolute;
          left: 6px;
          top: 14px;
          bottom: 14px;
          width: 3px;
          border-radius: 999px;
          background: rgba(0,53,155,0.18);
          transition: background 180ms ease, top 180ms ease, bottom 180ms ease;
        }
        .rp-body {
          flex: 1 1 auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .rp-section:hover { background: rgba(255,255,255,0.6); }
        .rp-section.is-active {
          background: #ffffff;
          border-color: rgba(0,53,155,0.12);
          box-shadow: 0 10px 30px rgba(0,53,155,0.1);
        }
        .rp-section.is-active::before { background: #00359B; top: 12px; bottom: 12px; }
        .rp-section:active { transform: scale(0.995); }

        /* 「查看解决方案」主按钮 */
        .rp-next {
          border: 0;
          border-radius: 999px;
          padding: 9px 16px;
          background: #00359B;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          box-shadow: 0 8px 18px rgba(0,53,155,0.22);
          transition: transform 160ms cubic-bezier(0.23,1,0.32,1), box-shadow 160ms ease;
        }
        .rp-next:hover { transform: translateY(-1px); box-shadow: 0 12px 24px rgba(0,53,155,0.28); }
        .rp-next:active { transform: scale(0.97); }

        /* 压力 / 面积 分段开关 */
        .rp-seg {
          display: inline-flex;
          padding: 2px;
          border-radius: 999px;
          background: rgba(0,53,155,0.08);
          flex-shrink: 0;
        }
        .rp-seg-btn {
          border: 0;
          border-radius: 999px;
          padding: 4px 11px;
          background: transparent;
          color: #7C89A6;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: background 160ms ease, color 160ms ease;
        }
        .rp-seg-btn.is-on { background: #fff; color: #00359B; box-shadow: 0 1px 4px rgba(0,53,155,0.18); }
      `}</style>
    </div>
  );
}
