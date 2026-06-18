/**
 * ReportPage — 步骤3：报告分析页面
 *
 * 视图1（足弓标注）：左侧 3D 足底模型 + 尺寸标注线（宽度/长度），右侧报告面板
 * 视图2（热力区域）：左侧 2D 足底轮廓 + 趾/前/中/后足四色方块分区，右侧报告面板
 *
 * 切换按钮位于左侧区域右上角，与设计图一致
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import FeetModel3D from "@/components/FeetModel3D";
import TopNavBar from "@/components/TopNavBar";
import PageBackground from "@/components/PageBackground";

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

function View3DAnnotated() {
  return (
    <div style={{ width: "100%", height: "100%", minHeight: "400px", position: "relative" }}>
      <FeetModel3D width="100%" height="100%" modelScale={1.1} style={{ minHeight: "400px" }} />

      {/* 左脚宽度标注 */}
      <HMeasureLine top="14%" left="8%" right="56%" />
      <MeasureDot style={{ top: "14%", left: "8%" }} />
      <MeasureDot style={{ top: "14%", left: "44%" }} />
      <DimensionLabel text="L: 106mm" style={{ top: "9%", left: "12%" }} />

      {/* 右脚宽度标注 */}
      <HMeasureLine top="14%" left="56%" right="8%" />
      <MeasureDot style={{ top: "14%", right: "44%" }} />
      <MeasureDot style={{ top: "14%", right: "8%" }} />
      <DimensionLabel text="R: 108mm" style={{ top: "9%", right: "12%" }} />

      {/* 左脚长度标注（垂直） */}
      <VMeasureLine left="6%" top="14%" bottom="22%" />
      <MeasureDot style={{ top: "14%", left: "6%" }} />
      <MeasureDot style={{ bottom: "22%", left: "6%" }} />
      <DimensionLabel text="L: 270mm" style={{ bottom: "28%", left: "0%" }} />

      {/* 右脚长度标注（垂直） */}
      <VMeasureLine left="94%" top="14%" bottom="22%" />
      <MeasureDot style={{ top: "14%", right: "6%" }} />
      <MeasureDot style={{ bottom: "22%", right: "6%" }} />
      <DimensionLabel text="R: 273mm" style={{ bottom: "28%", right: "0%" }} />
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

// ─── 右侧报告面板 ─────────────────────────────────────────────────────────────
function ReportPanel({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ width: "380px", minWidth: "320px", display: "flex", flexDirection: "column", gap: "12px", overflowY: "auto", maxHeight: "calc(100vh - 260px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ fontSize: "16px", fontWeight: "700", color: "#3A2A10" }}>用户测量报告</span>
        <button onClick={onNext} style={{ background: "#F5A623", border: "none", borderRadius: "8px", padding: "8px 16px", cursor: "pointer", fontSize: "13px", fontWeight: "600", color: "#fff" }}>
          查看解决方案 &gt;
        </button>
      </div>

      {/* 足底尺寸 */}
      <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 16px", boxShadow: "0 1px 8px rgba(200,120,0,0.07)" }}>
        <SectionTitle zh="足底尺寸" en="Foot Dimensions" />
        <MeasureRow items={[
          { label: "左脚足长", value: "270mm" },
          { label: "右脚足长", value: "272mm" },
          { label: "左脚足宽", value: "183mm" },
          { label: "右脚足宽", value: "180mm" },
        ]} />
      </div>

      {/* 足弓分析 */}
      <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 16px", boxShadow: "0 1px 8px rgba(200,120,0,0.07)" }}>
        <SectionTitle zh="足弓分析" en="Foot Arch Analysis" />
        <div style={{ display: "flex", gap: "10px" }}>
          <ArchCard side="左" type="扁平足" index="0.272" showTag />
          <ArchCard side="右" type="扁平足" index="0.272" showTag />
        </div>
      </div>

      {/* 压力/面积分析 */}
      <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 16px", boxShadow: "0 1px 8px rgba(200,120,0,0.07)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <SectionTitle zh="压力/面积分析" en="Foot Pressure Analysis" />
          <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#F5A623", textDecoration: "underline" }}>查看压力分析</button>
        </div>
        <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
          {["左脚", "右脚"].map(side => (
            <div key={side} style={{ flex: 1, background: "rgba(245,166,35,0.08)", borderRadius: "8px", padding: "10px" }}>
              <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>{side}总面积</div>
              <div style={{ fontSize: "18px", fontWeight: "700", color: "#3A2A10" }}>15773</div>
              <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                {["前足", "中足", "后足"].map(l => (
                  <div key={l} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#F5A623" }}>106cm²</div>
                    <div style={{ fontSize: "10px", color: "#8A6A40" }}>{l}面积</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#5A3A1A", marginBottom: "4px" }}>
          <span>双脚总面积 15773 cm²</span>
          <span>左右脚差异 7.4 cm²</span>
        </div>
      </div>

      {/* COP 平衡指标 */}
      <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 16px", boxShadow: "0 1px 8px rgba(200,120,0,0.07)" }}>
        <SectionTitle zh="cop平衡指标（压力中心）" en="COP Balance Index" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px" }}>
          <CopRow label="轨迹长度" value="126.28" unit="mm" />
          <CopRow label="活动总面积" value="7.74" unit="mm²" />
          <CopRow label="最大活程" value="0.94" unit="mm" />
          <CopRow label="摆动幅度" value="0.04" unit="mm" />
          <CopRow label="最大离心" value="0.71" unit="mm" />
          <CopRow label="前后平衡速度" value="12.96" unit="mm/s" />
          <CopRow label="前后方向标准差" value="4.72" unit="mm" />
          <CopRow label="左右方向标准差" value="0.21" unit="mm" />
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function ReportPage({ onNext, onHistory, onBack }: { onNext: () => void; onHistory: () => void; onBack: () => void }) {
  const { currentUser } = useApp();
  const [showSummary, setShowSummary] = useState(true);
  const [viewMode, setViewMode] = useState<"arch" | "zones">("arch"); // 视图切换

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <PageBackground />
      <TopNavBar currentStep={3} onHistoryClick={onHistory} />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 32px 80px", position: "relative", zIndex: 1, marginTop: "72px" }}>

        {/* 报告分析总结标题行 */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <span style={{ fontSize: "18px", fontWeight: "700", color: "#5A3A1A" }}>报告分析总结</span>
          <button onClick={() => setShowSummary(v => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#F5A623" }}>
            {showSummary ? "∧" : "∨"}
          </button>

          {/* 切换视图按钮（右上角） */}
          <div style={{ marginLeft: "auto" }}>
            <button
              onClick={() => setViewMode(v => v === "arch" ? "zones" : "arch")}
              style={{
                background: "#F5A623",
                border: "none",
                borderRadius: "8px",
                padding: "8px 16px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="12" height="12" rx="2" stroke="#fff" strokeWidth="1.5"/>
                <path d="M4 7h6M7 4v6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {viewMode === "arch" ? "切换视图 · 区域热力" : "切换视图 · 足弓标注"}
            </button>
          </div>
        </div>

        {/* 总结卡片 */}
        {showSummary && (
          <div style={{ background: "rgba(255,255,255,0.75)", borderRadius: "12px", padding: "14px 20px", marginBottom: "16px", display: "flex", gap: "32px", boxShadow: "0 1px 8px rgba(200,120,0,0.08)", flexWrap: "wrap" }}>
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

        {/* 主体左右布局 */}
        <div style={{ flex: 1, display: "flex", gap: "24px", minHeight: 0 }}>
          {/* 左侧：视图区域 */}
          <div style={{ flex: 1, position: "relative", minHeight: "400px" }}>
            {viewMode === "arch" ? <View3DAnnotated /> : <View2DZones />}
          </div>

          {/* 右侧：报告面板 */}
          <ReportPanel onNext={onNext} />
        </div>
      </main>

      {/* 底部操作栏 */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "14px 40px", display: "flex", alignItems: "center", gap: "24px", background: "rgba(253,245,216,0.85)", backdropFilter: "blur(8px)", borderTop: "1px solid rgba(245,166,35,0.2)", zIndex: 20 }}>
        <span style={{ fontSize: "14px", color: "#8A6A40", marginRight: "auto" }}>
          当前用户：{currentUser?.name ?? "—"} （ID:{currentUser?.id ?? "—"}）
        </span>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#5A3A1A", fontWeight: "600", textDecoration: "underline", textUnderlineOffset: "3px" }}>
          重新测量
        </button>
        <button onClick={onNext} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#F5A623", fontWeight: "700", textDecoration: "underline", textUnderlineOffset: "3px" }}>
          结束体验
        </button>
      </div>

      <div style={{ position: "fixed", bottom: "14px", left: "40px", fontSize: "12px", color: "rgba(90,58,26,0.6)", zIndex: 20 }}>
        powered by 矩桥工业
      </div>
    </div>
  );
}
