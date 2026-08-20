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
import TopNavBar from "@/components/TopNavBar";

// 报告页图标（设计稿原件切图，均已英文命名迁入项目）
const RICON = (name: string) => `/assets/icons/report-page/${name}.svg`;

// COP 热力图颜色映射上限（同采集页 colorLevel 默认；调小更浓）
const COP_HEAT_VMAX = 128;

// ─── 通用子组件 ───────────────────────────────────────────────────────────────
function SectionTitle({ zh, en }: { zh: string; en: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "10px" }}>
      <span style={{ width: "3px", height: "14px", background: "#F5A623", borderRadius: "2px", display: "inline-block", marginRight: "2px", flexShrink: 0 }} />
      <span style={{ fontSize: "14px", fontWeight: "700", color: "#3A2A10" }}>{zh}</span>
      <span style={{ fontSize: "11px", color: "#8A6A40" }}>{en}</span>
    </div>
  );
}

function MeasureRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div style={{ display: "flex", gap: "0", background: "rgba(255,255,255,0.7)", borderRadius: "10px", overflow: "hidden", marginBottom: "8px" }}>
      {items.map((item, i) => (
        <div key={i} style={{ flex: 1, padding: "10px 14px", borderRight: i < items.length - 1 ? "1px solid rgba(245,166,35,0.15)" : "none" }}>
          <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>{item.label}</div>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#3A2A10" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function ArchCard({ side, type, index, showTag }: { side: string; type: string; index: string; showTag?: boolean }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.7)", borderRadius: "10px", padding: "10px 14px" }}>
      <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>{side}脚足弓类型</div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <span style={{ fontSize: "16px", fontWeight: "700", color: "#F5A623" }}>{type}</span>
        {showTag && (
          <span style={{ fontSize: "10px", background: "rgba(245,166,35,0.15)", color: "#F5A623", borderRadius: "4px", padding: "2px 6px" }}>有足弓内翻迹象</span>
        )}
      </div>
      <div style={{ fontSize: "11px", color: "#8A6A40" }}>足弓指数 <span style={{ color: "#3A2A10", fontWeight: "600" }}>{index}</span></div>
    </div>
  );
}

function CopRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <div style={{ fontSize: "10px", color: "#8A6A40" }}>{label}</div>
      <div style={{ fontSize: "13px", fontWeight: "700", color: "#3A2A10" }}>{value}<span style={{ fontSize: "10px", fontWeight: "400", marginLeft: "2px" }}>{unit}</span></div>
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
      background: "#F79831",
      boxShadow: "0 1px 4px rgba(180,110,30,0.35)",
      pointerEvents: "none",
      transform: "translate(-50%, -50%)",
      zIndex: 10,
      ...style,
    }} />
  );
}

// 水平测量线（带两端箭头）
function HMeasureLine({ top, left, right, color = "#F5A623" }: { top: string; left: string; right: string; color?: string }) {
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
function VMeasureLine({ left, top, bottom, color = "#F5A623" }: { left: string; top: string; bottom: string; color?: string }) {
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
const REPORT_FOOT_SCALE = 3.05; // 报告页脚模缩放（略小于采集页最大档，视觉更协调）
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
            background: "rgba(255,183,102,0.2)",
            clipPath: `polygon(0% 0%, 100% 0%, 100% ${clipR}%, 0% ${clipL}%)`,
          }}
        />
        {/* 横向条带（浅）：长度虚线到对侧宽度虚线，高度到脚跟切点 */}
        <div style={{ position: "absolute", left: `${bandL}%`, top: `${rc.top}%`, width: `${bandR - bandL}%`, height: `${lightH}%`, background: "rgba(255,183,102,0.12)" }} />
      </div>
    );
  };

  // 虚线（尺寸界线）与双箭头实线（尺寸线）。宽度组用深橙、长度组用浅橙（设计稿双色）
  const WID_COLOR = "#F08614";
  const LEN_COLOR = "#F7B267";
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
    <div ref={wrapRef} style={{ width: "100%", height: "100%", minHeight: "400px", position: "relative" }}>
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
        style={{ minHeight: "400px", position: "relative", zIndex: 1 }}
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
          <span style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", fontSize: "12px", fontWeight: 700, color: "#c2410c", background: "rgba(255,255,255,0.85)", padding: "4px 14px", borderRadius: "999px", zIndex: 10, pointerEvents: "none", whiteSpace: "nowrap" }}>
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
                style={{ position: "absolute", top: `${y}%`, left: `${rects.left.rect.left - 6}%`, width: `${rects.right.rect.left + rects.right.rect.width + 6 - (rects.left.rect.left - 6)}%`, borderTop: "2px dashed #F5A623", zIndex: 9, pointerEvents: "none" }}
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
          <span style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", fontSize: "12px", fontWeight: 700, color: "#b45309", background: "rgba(255,244,229,0.92)", border: "1px solid #f6ad55", padding: "4px 14px", borderRadius: "999px", zIndex: 10, pointerEvents: "none", whiteSpace: "nowrap" }}>
            演示分区示意 —— 本次测量未获取到真实分区数据，请确认 Python 分析服务在运行后重新测量
          </span>
        </div>
      )}

      {/* COP：底部图例（起点→终点说明），避免只有孤零零的绿/红点看不懂 */}
      {mode === "cop" && settled && hasCop && (
        <div className="anno-appear">
          <div style={{ position: "absolute", left: "50%", bottom: "4%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: "7px", fontSize: "11px", fontWeight: 600, color: "#7A5A2A", background: "rgba(255,255,255,0.7)", padding: "3px 12px", borderRadius: "999px", zIndex: 10, pointerEvents: "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
            起点
            <span style={{ width: 34, height: 3, borderRadius: 2, background: "linear-gradient(90deg,#16a34a,#ef4444)", display: "inline-block" }} />
            终点
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            <span style={{ marginLeft: 4, color: "#a08a6a" }}>· COP 压力中心轨迹</span>
          </div>
        </div>
      )}

      {/* COP 占位示意（无真实 COP 数据时的兜底） */}
      {mode === "cop" && settled && !hasCop && (
        <div className="anno-appear">
          <span style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", fontSize: "13px", fontWeight: 700, color: "#8A6A40", background: "rgba(255,255,255,0.85)", padding: "6px 14px", borderRadius: "8px", zIndex: 5 }}>
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
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#3A2A10", background: color.replace("0.85", "0.2"), padding: "3px 8px", borderRadius: "6px", border: `1px solid ${color}` }}>
            {label}({count})
          </span>
          <div style={{ width: "24px", height: "1px", background: "rgba(90,58,26,0.3)" }} />
        </>
      ) : (
        <>
          <div style={{ width: "24px", height: "1px", background: "rgba(90,58,26,0.3)" }} />
          <span style={{ fontSize: "12px", fontWeight: "600", color: "#3A2A10", background: color.replace("0.85", "0.2"), padding: "3px 8px", borderRadius: "6px", border: `1px solid ${color}` }}>
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
    ctx.strokeStyle = "rgba(90,58,26,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 绘制区域分界线（虚线）
    const boundaries = [ZONE_BOUNDS.toe[1], ZONE_BOUNDS.forefoot[1], ZONE_BOUNDS.midfoot[1]];
    boundaries.forEach(yNorm => {
      const y = yNorm * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.strokeStyle = "rgba(245,166,35,0.6)";
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
                <div style={{ width: "20px", height: "1px", background: "rgba(90,58,26,0.3)" }} />
                <span style={{
                  fontSize: "11px", fontWeight: "600", color: "#3A2A10",
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
                  fontSize: "11px", fontWeight: "600", color: "#3A2A10",
                  background: info.fill.replace("0.85", "0.15"),
                  padding: "2px 6px", borderRadius: "5px",
                  border: `1px solid ${info.fill}`,
                }}>
                  {info.label}({info.count})
                </span>
                <div style={{ width: "20px", height: "1px", background: "rgba(90,58,26,0.3)" }} />
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
      <div style={{ fontSize: "13px", fontWeight: "600", color: "#5A3A1A" }}>
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
            <span style={{ fontSize: "11px", color: "#5A3A1A" }}>{info.label}</span>
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
    right: { index: 0.285, type: "扁平足", mli: 1.02, risk: "正常足弓", riskColor: "#2fb56b" },
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
        risk = "正常足弓";
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

const panelCard: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "12px",
  padding: "14px 16px",
  border: "1px solid #ffd9a8",
  boxShadow: "0 2px 8px rgba(220,185,146,0.28)",
};

const subCard: React.CSSProperties = {
  flex: 1,
  background: "linear-gradient(180deg,#fffdf8,#fff3de)",
  borderRadius: "10px",
  padding: "10px 12px",
  border: "1px solid #ffe3bd",
};

function BarTitle({ zh, en }: { zh: string; en: string }) {
  // 设计稿 section 标题：中文 20px/600、英文 14px/500、橙色竖条 #F08614
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "12px" }}>
      <span style={{ width: "4px", height: "20px", background: "#F08614", borderRadius: "2px", alignSelf: "center", flexShrink: 0 }} />
      <span style={{ fontSize: "20px", fontWeight: 600, color: "#17191c", whiteSpace: "nowrap" }}>{zh}</span>
      <span style={{ fontSize: "14px", fontWeight: 500, color: "#8a8275", whiteSpace: "nowrap" }}>{en}</span>
    </div>
  );
}

function ArchSubCard({ side, data }: { side: "左" | "右"; data: typeof REPORT_DATA.arch.left }) {
  // 大号足弓类型只显示中文短语（去掉"(flat foot)"这类英文括注），与设计稿一致
  const shortType = data.type.replace(/\s*[（(].*$/, "");
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: "#FFF2E4",
        borderRadius: "10px",
        padding: "11px 14px 12px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 上半区：两列各自顶/底对齐——左列 指数(上)/类型(下)，右列 图标(上)/风险(下)，
          高度固定 52px，让"扁平足"与"风险"、"指数"与"图标"分别齐平（同设计稿） */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", height: "52px" }}>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ fontSize: "12px", color: "#8a8275", whiteSpace: "nowrap" }}>
            {side}脚足弓指数 <span style={{ color: "#17191c", fontWeight: 600 }}>{data.index.toFixed(3)}</span>
          </div>
          {/* 设计稿字号 20px/#17191C；雅黑无 500 中黑，用 600 出分量（避免回退 400 发飘） */}
          <div style={{ fontSize: "20px", fontWeight: 600, color: "#17191c", lineHeight: 1 }}>
            {shortType}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <img
            src={RICON(data.risk.includes("内翻") ? "arch-varus" : data.risk.includes("外翻") ? "arch-valgus" : "arch-normal")}
            alt=""
            style={{ width: "36px", height: "36px" }}
          />
          <span style={{ fontSize: "12px", fontWeight: "700", color: data.riskColor, whiteSpace: "nowrap" }}>
            {data.risk}
          </span>
        </div>
      </div>

      {/* 分隔线（设计稿：rgba(240,200,158,0.8)） */}
      <div style={{ borderTop: "1px solid rgba(240,200,158,0.8)", margin: "8px 0" }} />

      {/* 下半区：足弓内外翻 …… MLI x.xx */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "12px", color: "#8a8275" }}>足弓内外翻</span>
        <span style={{ fontSize: "12px", color: "#6b6256" }}>
          MLI <span style={{ color: "#17191c", fontWeight: 700 }}>{data.mli.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );
}

type ReportView = "dims" | "arch" | "pressure" | "cop";

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
  // 压力 / 面积 双模式互切（对应设计图三与图四右下区块）
  const [mode, setMode] = useState<"pressure" | "area">("pressure");
  const P = data;
  // 点击卡片切换左侧固定视角；选中卡片高亮边框
  const clickable = (v: ReportView): React.CSSProperties => ({
    ...panelCard,
    cursor: "pointer",
    // 选中态：橙色描边 + 橙色投影（设计稿 border 2px #FF8400 / shadow rgba(255,132,0,0.4)）
    border: active === v ? "2px solid #FF8400" : panelCard.border,
    boxShadow: active === v ? "0 4px 6px rgba(255,132,0,0.4)" : panelCard.boxShadow,
  });

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "12px", minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
        <span style={{ fontSize: "18px", fontWeight: "800", color: "#17191c" }}>用户测量报告</span>
        <button
          onClick={onNext}
          style={{ background: "linear-gradient(90deg,#ff9a2e,#ff8400)", border: "none", borderRadius: "10px", padding: "9px 16px", cursor: "pointer", fontSize: "13px", fontWeight: "700", color: "#fff", boxShadow: "0 4px 12px rgba(255,132,0,0.3)" }}
        >
          查看解决方案 &gt;
        </button>
      </div>

      {/* 足底尺寸 */}
      <div style={clickable("dims")} onClick={() => onSelect("dims")}>
        <BarTitle zh="足底尺寸" en="Foot Dimensions" />
        <div style={{ display: "flex", gap: "10px" }}>
          {[
            { pair: [{ l: "左脚足长", v: P.dims.leftLen }, { l: "右脚足长", v: P.dims.rightLen }] },
            { pair: [{ l: "左脚足宽", v: P.dims.leftWid }, { l: "右脚足宽", v: P.dims.rightWid }] },
          ].map((g, i) => (
            <div key={i} style={{ ...subCard, display: "flex", alignItems: "center" }}>
              {g.pair.map((it, j) => (
                <div key={it.l} style={{ flex: 1, textAlign: "center", borderLeft: j ? "1px solid #f3ddc0" : "none" }}>
                  <div style={{ fontSize: "10px", color: "#8a8275", marginBottom: "3px" }}>{it.l}</div>
                  <div style={{ fontSize: "18px", fontWeight: "800", color: "#17191c" }}>
                    {it.v}<small style={{ fontSize: "10px", fontWeight: "600", color: "#8a8275" }}>mm</small>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 足弓分析 */}
      <div style={clickable("arch")} onClick={() => onSelect("arch")}>
        <BarTitle zh="足弓分析" en="Foot Arch Analysis" />
        <div style={{ display: "flex", gap: "10px" }}>
          <ArchSubCard side="左" data={P.arch.left} />
          <ArchSubCard side="右" data={P.arch.right} />
        </div>
      </div>

      {/* 压力/面积分析（双模式） */}
      <div style={clickable("pressure")} onClick={() => onSelect("pressure")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <BarTitle zh="压力/面积分析" en="Foot Pressure Analysis" />
          <button
            onClick={() => setMode((m) => (m === "pressure" ? "area" : "pressure"))}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: "700", color: "#ff8400", textDecoration: "underline", textUnderlineOffset: "3px", marginBottom: "10px" }}
          >
            {mode === "pressure" ? "查看面积分析" : "查看压力分析"}
          </button>
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
          {(["左", "右"] as const).map((side) => (
            <div key={side} style={subCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "10px", color: "#8a8275" }}>{side}脚总{mode === "pressure" ? "压力" : "面积"}</div>
                  <div style={{ fontSize: "19px", fontWeight: "800", color: "#17191c" }}>
                    {side === "左" ? (mode === "pressure" ? P.pressure.leftTotal : P.area.leftTotal) : (mode === "pressure" ? P.pressure.rightTotal : P.area.rightTotal)}
                  </div>
                </div>
                <img src={RICON(side === "左" ? "foot-left" : "foot-right")} alt="" style={{ width: "34px", height: "auto" }} />
              </div>
              <div style={{ display: "flex", marginTop: "8px" }}>
                {(mode === "pressure"
                  ? (() => {
                      const zp = side === "左" ? P.pressure.zonesPct : P.pressure.zonesPctR;
                      return [
                        { l: "前足压力", v: `${zp.fore}%` },
                        { l: "中足压力", v: `${zp.mid}%` },
                        { l: "后足压力", v: `${zp.hind}%` },
                      ];
                    })()
                  : (() => {
                      const za = side === "左" ? P.area.zones : P.area.zonesR;
                      return [
                        { l: "前足面积", v: `${za.fore}cm²` },
                        { l: "中足面积", v: `${za.mid}cm²` },
                        { l: "后足面积", v: `${za.hind}cm²` },
                      ];
                    })()
                ).map((z, i) => (
                  <div key={z.l} style={{ flex: 1, textAlign: "center", borderLeft: i ? "1px solid #f3ddc0" : "none" }}>
                    <div style={{ fontSize: "12px", fontWeight: "800", color: "#17191c" }}>{z.v}</div>
                    <div style={{ fontSize: "9px", color: "#8a8275", marginTop: "2px" }}>{z.l}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {mode === "pressure" ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: "700", color: "#3a352e", marginBottom: "6px" }}>
              <span>左脚压力比 {P.pressure.leftRatio}%</span>
              <span>右脚压力比 {100 - P.pressure.leftRatio}%</span>
            </div>
            <div style={{ height: "8px", borderRadius: "999px", background: "#ffd9a8", overflow: "hidden" }}>
              <div style={{ width: `${P.pressure.leftRatio}%`, height: "100%", background: "linear-gradient(90deg,#ff8400,#ff9a2e)", borderRadius: "999px" }} />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ ...subCard, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "#8a8275" }}>双脚总面积</span>
              <span style={{ fontSize: "16px", fontWeight: "800", color: "#17191c" }}>{P.area.bothTotal}<small style={{ fontSize: "10px", color: "#8a8275" }}> cm²</small></span>
            </div>
            <div style={{ ...subCard, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "11px", color: "#8a8275" }}>左右脚差异</span>
              <span style={{ fontSize: "16px", fontWeight: "800", color: "#17191c" }}>{P.area.diff}<small style={{ fontSize: "10px", color: "#8a8275" }}> cm²</small></span>
            </div>
          </div>
        )}
      </div>

      {/* COP 平衡指标 */}
      <div style={clickable("cop")} onClick={() => onSelect("cop")}>
        <BarTitle zh="cop平衡指标（压力中心）" en="COP Balance Index" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
          {P.cop.map((c) => (
            <div key={c.label} style={{ ...subCard, padding: "8px 9px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "9px", color: "#6b6256", whiteSpace: "nowrap" }}>{c.label}</span>
                <span style={{ width: "18px", height: "18px", borderRadius: "50%", background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 3px rgba(200,140,60,0.25)" }}>
                  <img src={RICON(c.icon)} alt="" style={{ width: "12px", height: "12px" }} />
                </span>
              </div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: "#17191c", whiteSpace: "nowrap", marginTop: "3px" }}>
                {c.value}<small style={{ fontSize: "9px", fontWeight: "600", color: "#8a8275" }}>{c.unit}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function ReportPage({ onNext, onHistory, onBack, onStepBack }: { onNext: () => void; onHistory: () => void; onBack: () => void; onStepBack?: (step: number) => void }) {
  const { currentUser, analysis } = useApp();
  // 真实测量分析结果 → 报告数据（Python 缺席时逐字段回退演示值）
  const reportData = useMemo(() => buildReportData(analysis), [analysis]);
  const [showSummary, setShowSummary] = useState(true);
  // 三视图轮换：尺寸标注 → 足弓分析(斜视) → 2D 分区
  // 四个固定视角，由右侧报告卡片点击驱动（足底尺寸/足弓分析/压力面积/COP）
  // 开发调试：URL 加 ?panel=pressure|arch|cop|dims 可直达对应视图
  const [viewMode, setViewMode] = useState<ReportView>(() => {
    const p = new URLSearchParams(window.location.search).get("panel");
    return ["dims", "arch", "pressure", "cop"].includes(p ?? "") ? (p as ReportView) : "dims";
  });

  return (
    <div className="report-shell">
      <div className="report-grid-bg" />
      {/* 报告页不显示"历史用户"，步骤条支持点击回退 */}
      <TopNavBar currentStep={3} transparent showHistory={false} onStepClick={onStepBack} />

      <main className="report-main">
        {/* 左区：标题 + 视图 + 底部信息 */}
        <section className="report-stage">
        {/* 报告分析总结标题行（视角切换由右侧 dashboard 卡片驱动） */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <span style={{ fontSize: "18px", fontWeight: "700", color: "#5A3A1A" }}>报告分析总结</span>
          <button onClick={() => setShowSummary(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#F5A623" }}>
            {showSummary ? "∧" : "∨"}
          </button>
        </div>

        {/* 总结卡片：与右侧报告数据同源（buildReportData.summary），不再硬编码演示值 */}
        {showSummary && (
          <div style={{ width: "fit-content", background: "rgba(255,255,255,0.75)", borderRadius: "12px", padding: "14px 20px", marginBottom: "16px", display: "flex", gap: "32px", boxShadow: "0 1px 8px rgba(200,120,0,0.08)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>左脚足弓分析</div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#3A2A10" }}>{reportData.summary.archLType}</div>
                <div style={{ fontSize: "11px", color: "#8A6A40" }}>AI={reportData.summary.archLIndex.toFixed(3)}</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>右脚足弓分析</div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#3A2A10" }}>{reportData.summary.archRType}</div>
                <div style={{ fontSize: "11px", color: "#8A6A40" }}>AI={reportData.summary.archRIndex.toFixed(3)}</div>
              </div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(245,166,35,0.2)", paddingLeft: "24px" }}>
              <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>左右脚压力占比</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#F5A623" }}>
                {reportData.pressure.leftRatio}%：{100 - reportData.pressure.leftRatio}%
              </div>
              <div style={{ fontSize: "11px", color: Math.abs(reportData.pressure.leftRatio - 50) <= 5 ? "#4A90E2" : "#ff5a2c" }}>
                {Math.abs(reportData.pressure.leftRatio - 50) <= 5
                  ? "压力分布较为均衡"
                  : `压力偏向${reportData.pressure.leftRatio > 50 ? "左" : "右"}脚`}
              </div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(245,166,35,0.2)", paddingLeft: "24px" }}>
              <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>COP轨迹长度</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#3A2A10" }}>{reportData.summary.copLen}</div>
              <div style={{ fontSize: "11px", color: "#4A90E2" }}>{reportData.summary.copNote}</div>
            </div>
          </div>
        )}

        {/* 视图区域：四模式共用同一常驻脚模。尺寸/压力面积/COP 为俯视（互切不旋转，
            仅换叠加层）；足弓分析为站姿（进/出时旋转过渡）。 */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          <FootStage dims={reportData.dims} arch={reportData.arch} mode={viewMode} />
        </div>

        {/* 左区底部信息栏（融入背景，无填充） */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "28px", padding: "10px 3% 2px 0" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#3d3d3d" }}>
            当前用户：{currentUser?.name ?? "—"}（ID:{currentUser ? formatUserId(currentUser.id) : "—"}）
          </span>
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#3d3d3d", fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "4px" }}>
            重新测量
          </button>
          <button onClick={onNext} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#ff8400", fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "4px" }}>
            结束体验
          </button>
          <span style={{ fontSize: "14px", color: "#c0b6a6", fontWeight: 700 }}>下载文件</span>
        </div>
        </section>

        {/* 右区：橙色渐变 dashboard */}
        <aside className="report-dash">
          <ReportPanel onNext={onNext} active={viewMode} onSelect={setViewMode} data={reportData} />
        </aside>
      </main>

      <style>{`
        .report-shell {
          position: relative;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          /* 与方案页同款：白 → 底部淡橙 #FFF4EC 渐变 */
          background: linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 42.5%, #FFF4EC 100%);
          /* 形成独立层叠上下文：让 z-index:-1 的网格画在本页背景之上、内容之下 */
          isolation: isolate;
          font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
          color: #1f1f1f;
        }
        /* 3D 场景地面网格（设计图效果）：透视平铺、无边界、底部清晰
           【向上渐浅】。线色全强度 0.30、只靠 mask 渐变（勿再叠 opacity）。
           与测量页 .measure-grid-bg 同参数。 */
        .report-grid-bg {
          position: fixed;
          left: -30vw;
          right: -30vw;
          top: -4vh;
          bottom: -55vh;
          pointer-events: none;
          background:
            linear-gradient(rgba(180, 150, 110, 0.30) 1px, transparent 1px),
            linear-gradient(90deg, rgba(180, 150, 110, 0.30) 1px, transparent 1px);
          background-size: 40px 40px;
          transform-origin: center top;
          transform: perspective(1100px) rotateX(52deg);
          -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.35) 62%, transparent 96%);
          mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.35) 62%, transparent 96%);
          /* 必须为负：fixed + 3D transform + mask 组合会被 Chromium 提升为独立合成层，
             z-index:0 时实际渲染会盖到 z-index:1 的页面内容上。见测量页同款注释。 */
          z-index: -1;
        }
        .report-main {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: minmax(0, 1fr) clamp(430px, 32vw, 540px);
          height: 100vh;
        }
        .report-stage {
          display: flex;
          flex-direction: column;
          min-width: 0;
          padding: clamp(92px, 10vh, 112px) clamp(16px, 1.6vw, 28px) 10px clamp(28px, 2.8vw, 48px);
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
        .report-dash {
          background:
            url("/assets/icons/report-page/dash-background.svg") right center / cover no-repeat,
            linear-gradient(200deg, #fbd09a 0%, #f8b96e 40%, #f6a44c 100%);
          padding: clamp(88px, 9.6vh, 108px) clamp(16px, 1.4vw, 26px) 14px;
          overflow: hidden;
          display: flex;
          min-height: 0;
        }
      `}</style>
    </div>
  );
}
