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
import FeetModel3D, { type FootRect } from "@/components/FeetModel3D";
import TopNavBar from "@/components/TopNavBar";

// 报告页图标（设计稿原件切图，均已英文命名迁入项目）
const RICON = (name: string) => `/assets/icons/report-page/${name}.svg`;

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
      background: "rgba(30,20,10,0.82)",
      color: "#fff",
      fontSize: "12px",
      fontWeight: "600",
      padding: "3px 8px",
      borderRadius: "4px",
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
      width: "10px",
      height: "10px",
      borderRadius: "50%",
      background: "#F5A623",
      border: "2px solid #fff",
      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
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

function View3DAnnotated({ dims }: { dims: ReportData["dims"] }) {
  const d = dims;
  const [rects, setRects] = useState<{ left: FootRect; right: FootRect } | null>(null);
  const handleRects = useCallback((r: { left: FootRect; right: FootRect }) => {
    setRects((prev) => (prev && JSON.stringify(prev) === JSON.stringify(r) ? prev : r));
  }, []);

  const renderShade = (rc: FootRect, side: string) => (
    <div key={side} style={{ position: "absolute", left: `${rc.left}%`, top: `${rc.top}%`, width: `${rc.width}%`, height: `${rc.height}%`, background: "rgba(255,183,102,0.22)", borderRadius: "6px" }} />
  );

  const renderFoot = (rc: FootRect, side: "L" | "R") => {
    const isL = side === "L";
    const lineX = isL ? rc.left - 3 : rc.left + rc.width + 3; // 足长尺寸线放外侧
    return (
      <div key={side}>
        {/* 足宽尺寸线（沿包围盒顶边） */}
        <HMeasureLine top={`${rc.top}%`} left={`${rc.left}%`} right={`${100 - rc.left - rc.width}%`} />
        <MeasureDot style={{ top: `${rc.top}%`, left: `${rc.left}%` }} />
        <MeasureDot style={{ top: `${rc.top}%`, left: `${rc.left + rc.width}%` }} />
        <DimensionLabel
          text={`${side}:${isL ? d.leftWid : d.rightWid}mm`}
          style={{ top: `${rc.top - 6}%`, left: `${rc.left + rc.width / 2}%`, transform: "translateX(-50%)" }}
        />
        {/* 足长尺寸线（沿包围盒外侧边） */}
        <VMeasureLine left={`${lineX}%`} top={`${rc.top}%`} bottom={`${100 - rc.top - rc.height}%`} />
        <MeasureDot style={{ top: `${rc.top}%`, left: `${lineX}%` }} />
        <MeasureDot style={{ top: `${rc.top + rc.height}%`, left: `${lineX}%` }} />
        <DimensionLabel
          text={`${side}:${isL ? d.leftLen : d.rightLen}mm`}
          style={{ top: `${rc.top + rc.height / 2}%`, left: `${isL ? lineX - 2 : lineX + 2}%`, transform: isL ? "translate(-100%, -50%)" : "translateY(-50%)" }}
        />
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: "100%", minHeight: "400px", position: "relative" }}>
      {/* 底衬在脚模之下 */}
      {rects && renderShade(rects.left, "sL")}
      {rects && renderShade(rects.right, "sR")}
      {/* 俯视固定视角，缩放与采集页最大档一致 */}
      <FeetModel3D
        width="100%"
        height="100%"
        modelScale={REPORT_FOOT_SCALE}
        lockedView
        onFootRects={handleRects}
        style={{ minHeight: "400px", position: "relative", zIndex: 1 }}
      />
      {rects && renderFoot(rects.left, "L")}
      {rects && renderFoot(rects.right, "R")}
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

// ─── 视图2：足弓分析（固定斜视 3D + 足弓高度标注，按设计稿） ──────────────────
function ViewArch3D() {
  return (
    <div style={{ width: "100%", height: "100%", minHeight: "400px", position: "relative" }}>
      <FeetModel3D width="100%" height="100%" modelScale={2.0} fixedCamera style={{ minHeight: "400px" }} />
      {/* 足弓高度标注：每只脚下方粗橙横线（地面基准）+ 中点圆点 + 向上垂直虚线 + 标签 */}
      {([{ left: "18%", width: "26%" }, { left: "56%", width: "26%" }] as const).map((g, i) => (
        <div key={i} style={{ position: "absolute", left: g.left, width: g.width, bottom: "18%", pointerEvents: "none" }}>
          <div style={{ height: "5px", background: "#FF8400", borderRadius: "3px" }} />
          <div style={{ position: "absolute", left: "50%", bottom: "2px", transform: "translateX(-50%)" }}>
            <div style={{ position: "absolute", left: "-4.5px", bottom: 0, width: "9px", height: "9px", borderRadius: "50%", background: "#FF8400" }} />
            <div style={{ position: "absolute", left: "-1px", bottom: "8px", height: "110px", borderLeft: "2px dashed #F08614" }} />
            <div style={{ position: "absolute", left: "-5px", bottom: "116px", width: "10px", height: "10px", borderRadius: "50%", background: "#F08614" }} />
          </div>
          <span style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: "136px", fontSize: "12px", fontWeight: 700, color: "#5A3A1A", whiteSpace: "nowrap", background: "rgba(255,255,255,0.85)", padding: "2px 8px", borderRadius: "6px" }}>
            {i === 0 ? "左足弓高度" : "右足弓高度"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 视图4：COP 压力中心轨迹（俯视 + 轨迹示意） ──────────────────────────────
function ViewCop() {
  return (
    <div style={{ width: "100%", height: "100%", minHeight: "400px", position: "relative" }}>
      <FeetModel3D width="100%" height="100%" modelScale={1.6} lockedView style={{ minHeight: "400px" }} />
      {/* COP 轨迹示意（后续接 Python cop 序列真实绘制） */}
      <svg style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} width="160" height="200" viewBox="0 0 160 200">
        <polyline
          points="80,150 76,132 84,118 78,100 86,86 80,70 84,54 79,42"
          fill="none"
          stroke="#FF8400"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1 5"
        />
        <circle cx="80" cy="150" r="5" fill="#FF8400" />
        <circle cx="79" cy="42" r="5" fill="#e0592c" />
      </svg>
      <span style={{ position: "absolute", left: "50%", bottom: "12%", transform: "translateX(-50%)", fontSize: "12px", fontWeight: 700, color: "#5A3A1A", background: "rgba(255,255,255,0.85)", padding: "2px 10px", borderRadius: "6px" }}>
        COP 压力中心轨迹
      </span>
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
      leftLen: ad ? Math.round(ad.left_length) : base.dims.leftLen,
      rightLen: ad ? Math.round(ad.right_length) : base.dims.rightLen,
      leftWid: ad ? Math.round(ad.left_width) : base.dims.leftWid,
      rightWid: ad ? Math.round(ad.right_width) : base.dims.rightWid,
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
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "10px" }}>
      <span style={{ width: "4px", height: "16px", background: "#F08614", borderRadius: "2px", alignSelf: "center" }} />
      <span style={{ fontSize: "15px", fontWeight: "800", color: "#17191c" }}>{zh}</span>
      <span style={{ fontSize: "11px", fontWeight: "600", color: "#8a8275" }}>{en}</span>
    </div>
  );
}

function ArchSubCard({ side, data }: { side: "左" | "右"; data: typeof REPORT_DATA.arch.left }) {
  return (
    <div style={{ ...subCard, display: "grid", gap: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "11px", color: "#8a8275" }}>{side}脚足弓指数 {data.index.toFixed(3)}</div>
          <div style={{ fontSize: "19px", fontWeight: "800", color: "#17191c", marginTop: "2px" }}>{data.type}</div>
        </div>
        <img
          src={RICON(data.risk.includes("内翻") ? "arch-varus" : data.risk.includes("外翻") ? "arch-valgus" : "arch-normal")}
          alt=""
          style={{ width: "32px", height: "auto" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "#8a8275" }}>足弓内外翻</span>
        <span style={{ fontSize: "11px", fontWeight: "700", color: data.riskColor }}>{data.risk}</span>
      </div>
      <div style={{ fontSize: "11px", color: "#6b6256", textAlign: "right" }}>MLI {data.mli.toFixed(2)}</div>
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
    border: active === v ? "2px solid #4A90E2" : panelCard.border,
    boxShadow: active === v ? "0 4px 14px rgba(74,144,226,0.25)" : panelCard.boxShadow,
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
export default function ReportPage({ onNext, onHistory, onBack }: { onNext: () => void; onHistory: () => void; onBack: () => void }) {
  const { currentUser, analysis } = useApp();
  // 真实测量分析结果 → 报告数据（Python 缺席时逐字段回退演示值）
  const reportData = useMemo(() => buildReportData(analysis), [analysis]);
  const [showSummary, setShowSummary] = useState(true);
  // 三视图轮换：尺寸标注 → 足弓分析(斜视) → 2D 分区
  // 四个固定视角，由右侧报告卡片点击驱动（足底尺寸/足弓分析/压力面积/COP）
  const [viewMode, setViewMode] = useState<ReportView>("dims");

  return (
    <div className="report-shell">
      <div className="report-grid-bg" />
      <TopNavBar currentStep={3} onHistoryClick={onHistory} transparent />

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

        {/* 总结卡片 */}
        {showSummary && (
          <div style={{ width: "fit-content", background: "rgba(255,255,255,0.75)", borderRadius: "12px", padding: "14px 20px", marginBottom: "16px", display: "flex", gap: "32px", boxShadow: "0 1px 8px rgba(200,120,0,0.08)", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: "24px" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>左脚足弓分析</div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#3A2A10" }}>扁平足</div>
                <div style={{ fontSize: "11px", color: "#8A6A40" }}>AI=0.272</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>右脚足弓分析</div>
                <div style={{ fontSize: "16px", fontWeight: "700", color: "#3A2A10" }}>扁平足</div>
                <div style={{ fontSize: "11px", color: "#8A6A40" }}>AI=0.272</div>
              </div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(245,166,35,0.2)", paddingLeft: "24px" }}>
              <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>左右脚压力占比</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#F5A623" }}>48%：52%</div>
              <div style={{ fontSize: "11px", color: "#4A90E2" }}>压力分布较为均衡</div>
            </div>
            <div style={{ borderLeft: "1px solid rgba(245,166,35,0.2)", paddingLeft: "24px" }}>
              <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>COP轨迹长度</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#3A2A10" }}>126.3mm</div>
              <div style={{ fontSize: "11px", color: "#4A90E2" }}>平衡控制良好</div>
            </div>
          </div>
        )}

        {/* 视图区域 */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {viewMode === "dims" ? <View3DAnnotated dims={reportData.dims} /> : viewMode === "arch" ? <ViewArch3D /> : viewMode === "pressure" ? <View2DZones /> : <ViewCop />}
        </div>

        {/* 左区底部信息栏（融入背景，无填充） */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "28px", padding: "10px 0 2px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#3d3d3d" }}>
            当前用户：{currentUser?.name ?? "—"}（ID:{currentUser?.id ?? "—"}）
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
          background:
            linear-gradient(180deg, rgba(255, 250, 240, 0.98) 0%, rgba(255, 255, 255, 0.98) 66%, #ffffff 100%),
            #fffdf8;
          font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
          color: #1f1f1f;
        }
        .report-grid-bg {
          position: fixed;
          left: -18vw;
          right: -18vw;
          top: 150px;
          bottom: -42vh;
          pointer-events: none;
          background:
            linear-gradient(rgba(184, 177, 166, 0.32) 1px, transparent 1px),
            linear-gradient(90deg, rgba(184, 177, 166, 0.3) 1px, transparent 1px);
          background-size: 26px 26px;
          transform-origin: center top;
          transform: perspective(1180px) rotateX(54deg) translateY(12px) scaleX(1.04) scaleY(1.04);
          opacity: 0.5;
          /* 自下而上渐隐：底部清晰、越往上越淡 */
          -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.35) 62%, transparent 96%);
          mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.35) 62%, transparent 96%);
          z-index: 0;
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
