/**
 * MeasurePage — 步骤2：实时压力采集页面
 * 设计：左侧 3D 足底模型（含足底蒙版引导）/ 2D热力图（含足弓内外翻）
 *       右侧：受压面积卡片组 + 压力卡片组
 *       底部：当前用户 + 重新测量 + 结束体验
 *
 * 蒙版说明：64×64 网格，中心不透明→边缘渐透明，两个足印区域基本不透明
 * 2D视图：左右脚热力网格 + 足弓内外翻角度指示器
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "@/contexts/AppContext";
import FeetModel3D from "@/components/FeetModel3D";
import TopNavBar from "@/components/TopNavBar";
import PageBackground from "@/components/PageBackground";

type CollectState = "idle" | "collecting" | "done";

// ─── 波浪装饰 ───────────────────────────────────────────────────────────────
function WaveDecor() {
  return (
    <svg viewBox="0 0 300 40" preserveAspectRatio="none" style={{ width: "100%", height: "40px", display: "block" }}>
      <path d="M0 20 Q37.5 5 75 20 Q112.5 35 150 20 Q187.5 5 225 20 Q262.5 35 300 20 L300 40 L0 40 Z" fill="#F5A623" opacity="0.18" />
      <path d="M0 25 Q37.5 10 75 25 Q112.5 40 150 25 Q187.5 10 225 25 Q262.5 40 300 25 L300 40 L0 40 Z" fill="#F5A623" opacity="0.12" />
    </svg>
  );
}

// ─── 数据卡片 ────────────────────────────────────────────────────────────────
function DataCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 18px 0", overflow: "hidden", boxShadow: "0 1px 8px rgba(200,120,0,0.08)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px", color: "#8A6A40" }}>{label}</span>
        <span style={{ fontSize: "18px", fontWeight: "700", color: "#3A2A10" }}>{value} <span style={{ fontSize: "13px", fontWeight: "500" }}>{unit}</span></span>
      </div>
      <WaveDecor />
    </div>
  );
}

function SmallStatCard({ value, unit, label }: { value: number; unit: string; label: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "10px", padding: "12px 14px", flex: 1, textAlign: "center", boxShadow: "0 1px 6px rgba(200,120,0,0.07)" }}>
      <div style={{ fontSize: "15px", fontWeight: "700", color: "#3A2A10" }}>{value} <span style={{ fontSize: "11px", fontWeight: "500" }}>{unit}</span></div>
      <div style={{ fontSize: "11px", color: "#8A6A40", marginTop: "2px" }}>{label}</div>
    </div>
  );
}

// ─── 压力色阶条 ──────────────────────────────────────────────────────────────
function PressureScale() {
  return (
    <div style={{ width: "18px", height: "220px", borderRadius: "9px", background: "linear-gradient(to bottom, #F5A623, #F5D020, #7ED321, #4A90E2, #0070C0)", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }} />
  );
}

// ─── 控制按钮 ────────────────────────────────────────────────────────────────
function ControlBtn({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ width: "38px", height: "38px", background: active ? "#F5A623" : "rgba(255,255,255,0.85)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: "12px", fontWeight: "700", color: active ? "#fff" : "#F5A623", transition: "all 0.15s", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
      {children}
    </button>
  );
}

// ─── 采集状态按钮 ─────────────────────────────────────────────────────────────
function CollectBtn({ label, active, onClick }: { label: string; active: boolean; onClick?: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: active ? "#F5A623" : "rgba(255,255,255,0.6)", border: `3px solid ${active ? "#F5A623" : "#C8A070"}`, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.25s", boxShadow: active ? "0 4px 16px rgba(245,166,35,0.35)" : "none" }}>
        <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: active ? "#fff" : "#C8A070", transition: "all 0.25s" }} />
      </div>
      <span style={{ fontSize: "13px", color: "#5A3A1A", fontWeight: active ? "600" : "400" }}>{label}</span>
    </div>
  );
}

// ─── 足底蒙版（Canvas 2D，64×64 网格，中心→边缘渐透明，两个足印区域不透明）────
function FootprintMask({ width, height, isActive }: { width: number; height: number; isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const COLS = 64;
    const ROWS = 64;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    // 两个足印的椭圆中心（相对于 0~1 坐标）
    const footprints = [
      { cx: 0.30, cy: 0.50, rx: 0.14, ry: 0.30 }, // 左脚
      { cx: 0.70, cy: 0.50, rx: 0.14, ry: 0.30 }, // 右脚
    ];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const nx = (col + 0.5) / COLS; // 归一化 x
        const ny = (row + 0.5) / ROWS; // 归一化 y

        // 计算到整体中心的距离（用于边缘渐透明）
        const dx = (nx - 0.5) * 2;
        const dy = (ny - 0.5) * 2;
        const centerDist = Math.sqrt(dx * dx + dy * dy); // 0~√2

        // 计算到最近足印椭圆的距离
        let minFootDist = Infinity;
        for (const fp of footprints) {
          const fdx = (nx - fp.cx) / fp.rx;
          const fdy = (ny - fp.cy) / fp.ry;
          const d = Math.sqrt(fdx * fdx + fdy * fdy);
          minFootDist = Math.min(minFootDist, d);
        }

        // 透明度计算：
        // 足印内部（minFootDist < 1）→ 高不透明度
        // 足印外部 → 根据中心距离渐透明
        let alpha: number;
        if (minFootDist <= 0.8) {
          alpha = isActive ? 0.85 : 0.70; // 足印核心区域
        } else if (minFootDist <= 1.2) {
          const t = (minFootDist - 0.8) / 0.4;
          const footAlpha = isActive ? 0.85 : 0.70;
          const edgeAlpha = Math.max(0, 0.35 - centerDist * 0.25);
          alpha = footAlpha * (1 - t) + edgeAlpha * t;
        } else {
          // 足印外：中心往边缘渐透明
          alpha = Math.max(0, 0.35 - centerDist * 0.3);
        }

        if (alpha < 0.02) continue;

        // 颜色：足印内橙色，外围浅橙
        const inFoot = minFootDist <= 1.0;
        const r = inFoot ? 245 : 250;
        const g = inFoot ? 166 : 200;
        const b = inFoot ? 35 : 120;

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.fillRect(col * cellW, row * cellH, cellW - 0.5, cellH - 0.5);
      }
    }

    // 足印轮廓线
    for (const fp of footprints) {
      ctx.beginPath();
      ctx.ellipse(fp.cx * W, fp.cy * H, fp.rx * W, fp.ry * H, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245,166,35,${isActive ? 0.6 : 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 引导文字
    ctx.fillStyle = `rgba(90,58,26,${isActive ? 0 : 0.6})`;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    if (!isActive) {
      ctx.fillText("请站在垫子上", W * 0.5, H * 0.92);
    }
  }, [isActive]);

  useEffect(() => {
    draw();
  }, [draw]);

    return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        bottom: "8%",
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: 5,
        opacity: 0.85,
        borderRadius: "8px",
      }}
    />
  );
}

// ─── 2D 足底热力图（单脚，16×16 网格）────────────────────────────────────────
function Foot2DHeatmap({
  side,
  isActive,
  valgusAngle,
}: {
  side: "left" | "right";
  isActive: boolean;
  valgusAngle: number; // 正=外翻，负=内翻
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const frameRef = useRef(0);

  // 足底轮廓点（归一化 0~1，脚趾朝上）
  const footOutline = [
    [0.35, 0.02], [0.50, 0.00], [0.65, 0.02], [0.72, 0.08],
    [0.78, 0.16], [0.80, 0.26], [0.78, 0.36], [0.82, 0.46],
    [0.82, 0.56], [0.78, 0.66], [0.72, 0.74], [0.65, 0.80],
    [0.60, 0.86], [0.58, 0.92], [0.56, 0.98],
    [0.44, 0.98], [0.42, 0.92], [0.40, 0.86],
    [0.35, 0.80], [0.28, 0.74], [0.22, 0.66],
    [0.18, 0.56], [0.18, 0.46], [0.22, 0.36],
    [0.20, 0.26], [0.22, 0.16], [0.28, 0.08],
  ];

  // 判断点是否在足底轮廓内（射线法）
  const isInFoot = (px: number, py: number): boolean => {
    let inside = false;
    const n = footOutline.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = footOutline[i][0], yi = footOutline[i][1];
      const xj = footOutline[j][0], yj = footOutline[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  // 热力颜色（0=蓝，0.5=绿，1=红）
  const heatColor = (v: number): [number, number, number] => {
    if (v < 0.25) {
      const t = v / 0.25;
      return [0, Math.round(t * 150), Math.round(200 + t * 55)];
    } else if (v < 0.5) {
      const t = (v - 0.25) / 0.25;
      return [0, Math.round(150 + t * 105), Math.round(255 - t * 255)];
    } else if (v < 0.75) {
      const t = (v - 0.5) / 0.25;
      return [Math.round(t * 255), 255, 0];
    } else {
      const t = (v - 0.75) / 0.25;
      return [255, Math.round(255 - t * 200), 0];
    }
  };

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const COLS = 16;
    const ROWS = 16;
    const cellW = W / COLS;
    const cellH = H / ROWS;

    frameRef.current += 0.05;
    const t = frameRef.current;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const nx = (col + 0.5) / COLS;
        const ny = (row + 0.5) / ROWS;

        if (!isInFoot(nx, ny)) continue;

        let pressure = 0;
        if (isActive) {
          // 模拟动态压力分布：前足（趾部）和后足（跟部）压力高
          const toeFactor = Math.max(0, 1 - ny / 0.35) * 0.8;
          const heelFactor = Math.max(0, (ny - 0.75) / 0.25) * 0.9;
          const midFactor = Math.max(0, 1 - Math.abs(ny - 0.5) / 0.25) * 0.3;
          const noise = Math.sin(nx * 8 + t) * Math.cos(ny * 6 + t * 0.7) * 0.15;
          pressure = Math.min(1, Math.max(0, toeFactor + heelFactor + midFactor + noise));
        }

        if (pressure < 0.05 && isActive) {
          // 低压区域不显示
          ctx.fillStyle = "rgba(200,200,220,0.15)";
        } else if (!isActive) {
          ctx.fillStyle = "rgba(200,200,220,0.2)";
        } else {
          const [r, g, b] = heatColor(pressure);
          ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
        }
        ctx.fillRect(col * cellW + 0.5, row * cellH + 0.5, cellW - 1, cellH - 1);
      }
    }

    // 绘制足底轮廓
    ctx.beginPath();
    footOutline.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x * W, y * H);
      else ctx.lineTo(x * W, y * H);
    });
    ctx.closePath();
    ctx.strokeStyle = "rgba(245,166,35,0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 绘制足弓内外翻角度指示器
    const footCenterX = W * 0.5;
    const footBottomY = H * 0.95;
    const arcRadius = W * 0.35;
    const angleRad = (valgusAngle * Math.PI) / 180;
    const isValgus = valgusAngle > 0; // 外翻
    const isVarus = valgusAngle < 0;  // 内翻

    if (Math.abs(valgusAngle) > 0.5) {
      // 弧形角度线
      ctx.beginPath();
      ctx.arc(footCenterX, footBottomY, arcRadius, Math.PI, Math.PI + angleRad, valgusAngle < 0);
      ctx.strokeStyle = isValgus ? "rgba(74,144,226,0.9)" : "rgba(231,76,60,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // 角度端点箭头
      const endX = footCenterX + arcRadius * Math.cos(Math.PI + angleRad);
      const endY = footBottomY + arcRadius * Math.sin(Math.PI + angleRad);
      ctx.beginPath();
      ctx.arc(endX, endY, 4, 0, Math.PI * 2);
      ctx.fillStyle = isValgus ? "rgba(74,144,226,0.9)" : "rgba(231,76,60,0.9)";
      ctx.fill();

      // 角度文字
      const labelX = footCenterX + (arcRadius + 14) * Math.cos(Math.PI + angleRad / 2);
      const labelY = footBottomY + (arcRadius + 14) * Math.sin(Math.PI + angleRad / 2);
      ctx.fillStyle = isValgus ? "#4A90E2" : "#E74C3C";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${Math.abs(valgusAngle).toFixed(1)}°`, labelX, labelY);
    }

    // 内外翻标签
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    if (isValgus) {
      ctx.fillStyle = "#4A90E2";
      ctx.fillText("外翻", footCenterX, H - 6);
    } else if (isVarus) {
      ctx.fillStyle = "#E74C3C";
      ctx.fillText("内翻", footCenterX, H - 6);
    } else {
      ctx.fillStyle = "#7ED321";
      ctx.fillText("正常", footCenterX, H - 6);
    }

    if (isActive) {
      animRef.current = requestAnimationFrame(drawFrame);
    }
  }, [isActive, valgusAngle]);

  useEffect(() => {
    drawFrame();
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [drawFrame]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
      <div style={{ fontSize: "12px", fontWeight: "600", color: "#5A3A1A" }}>
        {side === "left" ? "左脚" : "右脚"}
      </div>
      <canvas
        ref={canvasRef}
        width={120}
        height={180}
        style={{ borderRadius: "8px", background: "rgba(255,255,255,0.15)" }}
      />
      <div style={{
        fontSize: "11px",
        fontWeight: "600",
        color: valgusAngle > 0 ? "#4A90E2" : valgusAngle < 0 ? "#E74C3C" : "#7ED321",
        background: "rgba(255,255,255,0.7)",
        borderRadius: "6px",
        padding: "3px 8px",
      }}>
        {valgusAngle > 0 ? `外翻 ${valgusAngle.toFixed(1)}°` : valgusAngle < 0 ? `内翻 ${Math.abs(valgusAngle).toFixed(1)}°` : "正常"}
      </div>
    </div>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function MeasurePage({ onNext, onHistory }: { onNext: () => void; onHistory: () => void }) {
  const { currentUser } = useApp();
  const [collectState, setCollectState] = useState<CollectState>("idle");
  const [show3D, setShow3D] = useState(true);
  const [modelContainerSize, setModelContainerSize] = useState({ w: 400, h: 400 });
  const modelContainerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 模拟足弓内外翻角度（实际应来自传感器）
  const leftValgus = collectState === "collecting" ? -3.5 : collectState === "done" ? -3.5 : 0;
  const rightValgus = collectState === "collecting" ? 2.8 : collectState === "done" ? 2.8 : 0;

  const isActive = collectState !== "idle";
  const areaData = { realtime: isActive ? 132 : 0, avg: isActive ? 132 : 0, peak: isActive ? 132 : 0, total: isActive ? 225 : 0 };
  const pressureData = { realtime: isActive ? 132 : 0, avg: isActive ? 132 : 0, peak: isActive ? 132 : 0, total: isActive ? 124452 : 0 };

  const handleStart = () => {
    if (collectState === "idle") {
      setCollectState("collecting");
      timerRef.current = setTimeout(() => setCollectState("done"), 4000);
    }
  };

  const handleStopCollecting = () => {
    if (collectState === "collecting") {
      if (timerRef.current) clearTimeout(timerRef.current);
      setCollectState("done");
    }
  };

  const handleDoneClick = () => {
    if (collectState === "done") {
      onNext();
    }
  };

  // 监听容器尺寸
  useEffect(() => {
    const el = modelContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setModelContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <PageBackground />
      <TopNavBar currentStep={2} onHistoryClick={onHistory} />

      <main style={{ flex: 1, display: "flex", padding: "24px 32px 80px", gap: "24px", position: "relative", zIndex: 1, marginTop: "72px" }}>
        {/* 左侧 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: "12px", display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "18px", fontWeight: "700", color: "#5A3A1A" }}>实时压力展示</span>
            <span style={{ fontSize: "13px", color: "#8A6A40" }}>Real-time Pressure Monitoring</span>
          </div>

          <div style={{ flex: 1, display: "flex", gap: "12px", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", paddingTop: "20px" }}>
              <PressureScale />
            </div>

            {/* 模型/热力图容器 */}
            <div ref={modelContainerRef} style={{ flex: 1, minHeight: "380px", position: "relative" }}>
              {show3D ? (
                <>
                  <FeetModel3D
                    width="100%"
                    height="100%"
                    modelScale={1.2}
                    autoRotate={collectState === "collecting"}
                    style={{ minHeight: "380px" }}
                  />
                  {/* 足底蒙版：叠加在3D模型下方区域 */}
                  <FootprintMask
                    width={Math.round(modelContainerSize.w * 0.9)}
                    height={Math.round(modelContainerSize.h * 0.55)}
                    isActive={isActive}
                  />
                </>
              ) : (
                /* 2D 热力图视图 */
                <div style={{
                  width: "100%",
                  height: "100%",
                  minHeight: "380px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.15)",
                  borderRadius: "16px",
                  gap: "16px",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#5A3A1A", marginBottom: "4px" }}>
                    足底压力分布 · 足弓内外翻分析
                  </div>
                  <div style={{ display: "flex", gap: "48px", alignItems: "flex-start" }}>
                    <Foot2DHeatmap side="left" isActive={isActive} valgusAngle={leftValgus} />
                    <Foot2DHeatmap side="right" isActive={isActive} valgusAngle={rightValgus} />
                  </div>
                  {/* 内外翻说明 */}
                  <div style={{ display: "flex", gap: "16px", fontSize: "11px" }}>
                    <span style={{ color: "#E74C3C", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#E74C3C", display: "inline-block" }} />
                      内翻（Varus）
                    </span>
                    <span style={{ color: "#7ED321", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#7ED321", display: "inline-block" }} />
                      正常
                    </span>
                    <span style={{ color: "#4A90E2", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#4A90E2", display: "inline-block" }} />
                      外翻（Valgus）
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* 右侧控制按钮 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", justifyContent: "center" }}>
              <ControlBtn active={show3D} onClick={() => setShow3D(true)}>3D</ControlBtn>
              <ControlBtn active={!show3D} onClick={() => setShow3D(false)}>2D</ControlBtn>
              <ControlBtn>＋</ControlBtn>
              <ControlBtn>－</ControlBtn>
              <ControlBtn>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8a6 6 0 1 1 1.5 4" stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round"/><path d="M2 12V8h4" stroke="#F5A623" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </ControlBtn>
            </div>
          </div>

          {/* 采集状态按钮 */}
          <div style={{ display: "flex", justifyContent: "center", gap: "48px", marginTop: "24px" }}>
            <CollectBtn label="开始采集" active={collectState === "idle"} onClick={handleStart} />
            <CollectBtn label="正在采集" active={collectState === "collecting"} onClick={handleStopCollecting} />
            <CollectBtn label="采集完成" active={collectState === "done"} onClick={handleDoneClick} />
          </div>
        </div>

        {/* 右侧数据面板 */}
        <div style={{ width: "380px", minWidth: "320px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <div style={{ marginBottom: "10px" }}>
              <span style={{ fontSize: "16px", fontWeight: "700", color: "#5A3A1A" }}>受压面积</span>
              <span style={{ fontSize: "12px", color: "#8A6A40", marginLeft: "10px" }}>Pressure Contact Area</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <DataCard label="实时面积" value={areaData.realtime} unit="cm²" />
              <div style={{ display: "flex", gap: "10px" }}>
                <SmallStatCard value={areaData.avg} unit="cm²" label="平均面积" />
                <SmallStatCard value={areaData.peak} unit="cm²" label="峰值面积" />
                <SmallStatCard value={areaData.total} unit="cm²" label="面积总值" />
              </div>
            </div>
          </div>

          <div>
            <div style={{ marginBottom: "10px" }}>
              <span style={{ fontSize: "16px", fontWeight: "700", color: "#5A3A1A" }}>压力</span>
              <span style={{ fontSize: "12px", color: "#8A6A40", marginLeft: "10px" }}>Pressure</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <DataCard label="实时压力" value={pressureData.realtime} unit="pa" />
              <div style={{ display: "flex", gap: "10px" }}>
                <SmallStatCard value={pressureData.avg} unit="pa" label="平均压力" />
                <SmallStatCard value={pressureData.peak} unit="pa" label="峰值压力" />
                <SmallStatCard value={pressureData.total} unit="pa" label="压力总值" />
              </div>
            </div>
          </div>

          {/* 足弓内外翻摘要（仅在有数据时显示） */}
          {isActive && (
            <div style={{ background: "rgba(255,255,255,0.82)", borderRadius: "12px", padding: "14px 16px", boxShadow: "0 1px 8px rgba(200,120,0,0.08)" }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#5A3A1A", marginBottom: "10px" }}>足弓内外翻</div>
              <div style={{ display: "flex", gap: "12px" }}>
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>左脚</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", color: "#E74C3C" }}>内翻 {Math.abs(leftValgus).toFixed(1)}°</div>
                </div>
                <div style={{ width: "1px", background: "rgba(245,166,35,0.2)" }} />
                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: "#8A6A40", marginBottom: "4px" }}>右脚</div>
                  <div style={{ fontSize: "16px", fontWeight: "700", color: "#4A90E2" }}>外翻 {rightValgus.toFixed(1)}°</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 底部操作栏 */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, padding: "14px 40px", display: "flex", alignItems: "center", gap: "24px", background: "rgba(253,245,216,0.85)", backdropFilter: "blur(8px)", borderTop: "1px solid rgba(245,166,35,0.2)", zIndex: 20 }}>
        <span style={{ fontSize: "14px", color: "#8A6A40", marginRight: "auto" }}>
          当前用户：{currentUser?.name ?? "—"} （ID:{currentUser?.id ?? "—"}）
        </span>
        <button onClick={() => setCollectState("idle")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "14px", color: "#5A3A1A", fontWeight: "600", textDecoration: "underline", textUnderlineOffset: "3px" }}>
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
