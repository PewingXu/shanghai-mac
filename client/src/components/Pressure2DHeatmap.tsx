/**
 * 2D 压力矩阵热力图（暖色 UI 版）
 * - 左右脚分两个面板，每格显示 ADC 数值
 * - Hover tooltip 显示精确信息
 * - 鼠标滚轮缩放 + 拖动平移
 * - 配色适配当前暖色系 UI：浅底、空格浅色网格、压力块用 jet 色图（与左侧色阶一致）
 * 移植自 huisheng-system，仅调整配色。
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Move } from "lucide-react";
import { computeMliLine } from "@/lib/mli";

interface Props {
  realtimeData: number[][] | null;
  /** 是否在每个非零格内显示 ADC 数值（默认 true） */
  showValues?: boolean;
  /** 颜色映射上限（colorbar 上限），默认 150 */
  vmax?: number;
}

interface TooltipInfo {
  x: number;
  y: number;
  row: number;
  col: number;
  side: "left" | "right";
  value: number;
}

const ROWS = 64;
const COLS_PER_FOOT = 32;
const TOTAL_COLS = 64;

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

// ==== 暖色主题 ====
const THEME = {
  canvasBg: "#f9fbff",
  emptyCell: "#e9f0fd", // 空格（无压力）浅奶油
  gridLine: "rgba(115,144,203,0.18)",
  panelBorder: "#073dab",
  panelTitle: "#1b3c7e",
  mliText: "#1b3c7e",
  mliRangeDash: "rgba(115,144,203,0.55)",
  mliMidline: "rgba(10,57,151,0.95)",
  mliDot: "#0a3997",
  chipBg: "rgba(255, 255, 255, 0.92)",
  lateralLabel: "#5b9bd5", // 外侧
  medialLabel: "#e0592c", // 内侧
};

function normalize(v: number, vmin: number, vmax: number): number {
  if (vmax <= vmin) return v <= vmin ? 0 : 1;
  return Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
}

/** matplotlib 经典 jet 色图：深蓝→蓝→青→黄→红→深红（与页面左侧色阶方向一致） */
function jetRGB(t: number): [number, number, number] {
  if (t <= 0) return [0, 0, 127];
  if (t >= 1) return [127, 0, 0];
  if (t < 0.125) {
    const s = t / 0.125;
    return [0, 0, Math.round(127 + s * 128)];
  }
  if (t < 0.375) {
    const s = (t - 0.125) / 0.25;
    return [0, Math.round(s * 255), 255];
  }
  if (t < 0.625) {
    const s = (t - 0.375) / 0.25;
    return [Math.round(s * 255), 255, Math.round(255 - s * 255)];
  }
  if (t < 0.875) {
    const s = (t - 0.625) / 0.25;
    return [255, Math.round(255 - s * 255), 0];
  }
  const s = (t - 0.875) / 0.125;
  return [Math.round(255 - s * 128), 0, 0];
}

function heatColor(v: number, vmin: number, vmax: number): string {
  const t = normalize(v, vmin, vmax);
  const [r, g, b] = jetRGB(t);
  return `rgb(${r},${g},${b})`;
}

/** 活动格文字颜色：jet 中段（青/绿/黄）背景亮用深色字，其余用白字 */
function textColorFor(v: number, vmin: number, vmax: number): string {
  const t = normalize(v, vmin, vmax);
  return t > 0.3 && t < 0.75 ? "#000" : "#fff";
}

export default function Pressure2DHeatmap({ realtimeData, showValues = true, vmax }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStateRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // 颜色映射范围：开发者侧固定。vmin=0（底噪已在采集端过滤），vmax=150（中等压力即呈红）
  const VMIN = 0;
  const VMAX = Math.max(1, vmax ?? 150);

  // 预处理：new[r][c] = old[c][r]（旋转+翻转，使左右脚落到 0-31 / 32-63，脚尖朝上）
  const displayData = useMemo(() => {
    if (!realtimeData) return null;
    const N = TOTAL_COLS;
    const result: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        result[r][c] = realtimeData[c]?.[r] ?? 0;
      }
    }
    return result;
  }, [realtimeData]);

  const stats = useMemo(() => {
    if (!displayData) return { max: 0, activeCells: 0, totalPressure: 0, leftPressure: 0, rightPressure: 0 };
    let max = 0;
    let activeCells = 0;
    let totalPressure = 0;
    let leftPressure = 0;
    let rightPressure = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < TOTAL_COLS; c++) {
        const v = displayData[r]?.[c] ?? 0;
        if (v > 0) {
          activeCells++;
          totalPressure += v;
          if (v > max) max = v;
          if (c < COLS_PER_FOOT) leftPressure += v;
          else rightPressure += v;
        }
      }
    }
    return { max, activeCells, totalPressure, leftPressure, rightPressure };
  }, [displayData]);

  const baseCellSize = useMemo(() => {
    if (containerSize.width <= 0) return 8;
    const gap = 16;
    const padding = 32;
    const usableW = containerSize.width - gap - padding;
    return Math.max(4, Math.floor(usableW / TOTAL_COLS));
  }, [containerSize.width]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const gap = 16;
    const padding = 16;
    const cellSize = baseCellSize;
    const totalW = COLS_PER_FOOT * cellSize * 2 + gap + padding * 2;
    const totalH = ROWS * cellSize + padding * 2;

    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalW, totalH);

    // 浅色背景
    ctx.fillStyle = THEME.canvasBg;
    ctx.fillRect(0, 0, totalW, totalH);

    if (!displayData) {
      ctx.fillStyle = "#929db3";
      ctx.font = '14px "PingFang SC", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("等待数据…", totalW / 2, totalH / 2);
      return;
    }

    const effectiveVmax = VMAX;
    const effectiveVmin = VMIN;
    const effectiveCell = cellSize * scale;
    const fontSize = Math.max(5, Math.min(cellSize * 0.55, 11));
    const showText = showValues && effectiveCell >= 10;

    for (let panel = 0; panel < 2; panel++) {
      const colStart = panel === 0 ? 0 : COLS_PER_FOOT;
      const offsetX = padding + (panel === 0 ? 0 : COLS_PER_FOOT * cellSize + gap);

      // 面板边框
      ctx.strokeStyle = THEME.panelBorder;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(offsetX - 1, padding - 1, COLS_PER_FOOT * cellSize + 2, ROWS * cellSize + 2);

      // 面板标题
      ctx.fillStyle = THEME.panelTitle;
      ctx.font = 'bold 11px "PingFang SC", sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(panel === 0 ? "左脚 L" : "右脚 R", offsetX + 2, padding - 14);

      const sideForInfo: "left" | "right" = panel === 0 ? "left" : "right";
      const titleLine = computeMliLine(displayData, colStart, colStart + COLS_PER_FOOT, sideForInfo);
      if (titleLine && titleLine.lateralSum > 0) {
        const mliVal = titleLine.medialSum / titleLine.lateralSum;
        ctx.fillStyle = THEME.mliText;
        ctx.font = "10px monospace";
        ctx.fillText(
          `内 ${Math.round(titleLine.medialSum)} : 外 ${Math.round(titleLine.lateralSum)}  MLI=${mliVal.toFixed(2)}`,
          offsetX + 50,
          padding - 14,
        );
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS_PER_FOOT; c++) {
          const realCol = colStart + c;
          const v = displayData[r]?.[realCol] ?? 0;
          const px = offsetX + c * cellSize;
          const py = padding + r * cellSize;

          if (v > 0) {
            // 有压力 → jet 暖色块
            ctx.fillStyle = heatColor(v, effectiveVmin, effectiveVmax);
            ctx.fillRect(px, py, cellSize, cellSize);
            if (showText) {
              ctx.fillStyle = textColorFor(v, effectiveVmin, effectiveVmax);
              ctx.font = `${fontSize}px monospace`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(String(Math.round(v)), px + cellSize / 2, py + cellSize / 2);
            }
          } else {
            // 空格 → 浅奶油 + 细网格线（呈现矩阵结构，不再是深蓝）
            ctx.fillStyle = THEME.emptyCell;
            ctx.fillRect(px, py, cellSize, cellSize);
            if (cellSize >= 6) {
              ctx.strokeStyle = THEME.gridLine;
              ctx.lineWidth = 0.5;
              ctx.strokeRect(px + 0.25, py + 0.25, cellSize - 0.5, cellSize - 0.5);
            }
          }
        }
      }

      // ===== MLI 内/外侧分界线可视化 =====
      const side: "left" | "right" = panel === 0 ? "left" : "right";
      const line = computeMliLine(displayData, colStart, colStart + COLS_PER_FOOT, side);
      const topY = padding;
      const botY = padding + ROWS * cellSize;

      ctx.save();
      if (line && line.points.length >= 2) {
        const toXY = (row: number, col: number) => ({
          x: offsetX + (col - colStart + 0.5) * cellSize,
          y: padding + (row + 0.5) * cellSize,
        });
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // 各段范围虚线
        ctx.strokeStyle = THEME.mliRangeDash;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        for (const p of line.points) {
          if (p.cMin === undefined || p.cMax === undefined) continue;
          const left = toXY(p.row, p.cMin);
          const right = toXY(p.row, p.cMax);
          ctx.beginPath();
          ctx.moveTo(left.x, left.y);
          ctx.lineTo(right.x, right.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // 中线折线
        const xy = line.points.map((p) => toXY(p.row, p.col));
        ctx.strokeStyle = THEME.mliMidline;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 5]);
        ctx.beginPath();
        ctx.moveTo(xy[0].x, xy[0].y);
        for (let i = 1; i < xy.length; i++) ctx.lineTo(xy[i].x, xy[i].y);
        ctx.stroke();
        ctx.setLineDash([]);

        // 中心点
        ctx.fillStyle = THEME.mliDot;
        for (const p of xy) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const lineX = offsetX + (COLS_PER_FOOT / 2) * cellSize;
        ctx.strokeStyle = THEME.mliMidline;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(lineX, topY);
        ctx.lineTo(lineX, botY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 内外侧标签
      const leftLabel = panel === 0 ? "外侧 L" : "内侧 M";
      const rightLabel = panel === 0 ? "内侧 M" : "外侧 L";
      const leftLabelColor = panel === 0 ? THEME.lateralLabel : THEME.medialLabel;
      const rightLabelColor = panel === 0 ? THEME.medialLabel : THEME.lateralLabel;

      const labelY = topY + 14;
      const quarter = (COLS_PER_FOOT / 4) * cellSize;
      const leftHalfCenter = offsetX + quarter;
      const rightHalfCenter = offsetX + COLS_PER_FOOT * cellSize - quarter;

      ctx.font = 'bold 13px "PingFang SC", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const drawLabelChip = (text: string, x: number, color: string) => {
        const padX = 6;
        const w = ctx.measureText(text).width + padX * 2;
        const h = 18;
        ctx.fillStyle = THEME.chipBg;
        ctx.fillRect(x - w / 2, labelY - h / 2, w, h);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - w / 2, labelY - h / 2, w, h);
        ctx.fillStyle = color;
        ctx.fillText(text, x, labelY);
      };
      drawLabelChip(leftLabel, leftHalfCenter, leftLabelColor);
      drawLabelChip(rightLabel, rightHalfCenter, rightLabelColor);
      ctx.restore();
    }
  }, [baseCellSize, displayData, showValues, scale, VMAX]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // 居中：canvas 因格子取整比容器略窄，补偿偏移使其在视窗内水平/垂直居中
  useEffect(() => {
    if (containerSize.width <= 0) return;
    const cellSize = baseCellSize;
    const totalW = COLS_PER_FOOT * cellSize * 2 + 16 + 32;
    const totalH = ROWS * cellSize + 32;
    setOffset({
      x: Math.max(0, (containerSize.width - totalW) / 2),
      y: Math.max(0, (containerSize.height - totalH) / 2),
    });
  }, [containerSize.width, containerSize.height, baseCellSize]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
      if (newScale === scale) return;
      const ratio = newScale / scale;
      setOffset((prev) => ({ x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio }));
      setScale(+newScale.toFixed(3));
    },
    [scale],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
      setIsDragging(true);
      setTooltip(null);
    },
    [offset],
  );

  const handleMouseUp = useCallback(() => {
    dragStateRef.current = null;
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragStateRef.current) {
        const ds = dragStateRef.current;
        setOffset({ x: ds.baseX + (e.clientX - ds.startX), y: ds.baseY + (e.clientY - ds.startY) });
        return;
      }
      if (!displayData) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / scale;
      const my = (e.clientY - rect.top) / scale;
      const padding = 16;
      const gap = 16;
      const cellSize = baseCellSize;
      const leftPanelStart = padding;
      const leftPanelEnd = padding + COLS_PER_FOOT * cellSize;
      const rightPanelStart = leftPanelEnd + gap;
      const rightPanelEnd = rightPanelStart + COLS_PER_FOOT * cellSize;

      let side: "left" | "right" | null = null;
      let panelOffsetX = 0;
      if (mx >= leftPanelStart && mx <= leftPanelEnd) {
        side = "left";
        panelOffsetX = leftPanelStart;
      } else if (mx >= rightPanelStart && mx <= rightPanelEnd) {
        side = "right";
        panelOffsetX = rightPanelStart;
      }
      if (!side || my < padding || my > padding + ROWS * cellSize) {
        setTooltip(null);
        return;
      }
      const c = Math.floor((mx - panelOffsetX) / cellSize);
      const r = Math.floor((my - padding) / cellSize);
      if (c < 0 || c >= COLS_PER_FOOT || r < 0 || r >= ROWS) {
        setTooltip(null);
        return;
      }
      const realCol = side === "left" ? c : c + COLS_PER_FOOT;
      const v = displayData[r]?.[realCol] ?? 0;
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      setTooltip({
        x: e.clientX - (viewportRect?.left ?? 0),
        y: e.clientY - (viewportRect?.top ?? 0),
        row: r,
        col: realCol,
        side,
        value: v,
      });
    },
    [displayData, scale, baseCellSize],
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    handleMouseUp();
  }, [handleMouseUp]);

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden" style={{ background: "linear-gradient(180deg,#f9fbff,#ecf3ff)" }}>
      {/* 顶部统计 */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0" style={{ borderBottom: "1px solid #c4d3f2", background: "rgba(255,255,255,0.6)" }}>
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span style={{ color: "#757c8a" }}>最大ADC </span>
            <span className="font-mono font-semibold" style={{ color: "#d6336c" }}>{stats.max}</span>
          </div>
          <div>
            <span style={{ color: "#757c8a" }}>活动点 </span>
            <span className="font-mono font-semibold" style={{ color: "#3d3d3d" }}>{stats.activeCells}</span>
          </div>
          <div>
            <span style={{ color: "#757c8a" }}>总压 </span>
            <span className="font-mono font-semibold" style={{ color: "#3d3d3d" }}>{stats.totalPressure}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "#073dab" }} />
            <span style={{ color: "#757c8a" }}>L</span>
            <span className="font-mono" style={{ color: "#3d3d3d" }}>{stats.leftPressure}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: "#1544a2" }} />
            <span style={{ color: "#757c8a" }}>R</span>
            <span className="font-mono" style={{ color: "#3d3d3d" }}>{stats.rightPressure}</span>
          </div>
        </div>
      </div>

      {/* 热力图主区域 */}
      <div ref={containerRef} className="flex-1 relative min-h-0">
        <div
          ref={viewportRef}
          className={`absolute inset-0 overflow-hidden ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <canvas
            ref={canvasRef}
            className="rounded-md select-none"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: "0 0",
              transition: isDragging ? "none" : "transform 0.08s ease-out",
            }}
          />
        </div>

        {tooltip && !isDragging && (
          <div
            className="absolute pointer-events-none z-20 rounded-md px-2.5 py-1.5 text-xs"
            style={{
              background: "rgba(255,255,255,0.96)",
              border: "1px solid #c4d3f2",
              boxShadow: "0 6px 18px rgba(50,93,180,0.18)",
              color: "#3d3d3d",
              left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth ?? 400) - 140),
              top: Math.max(0, tooltip.y - 60),
            }}
          >
            <div className="font-semibold mb-0.5">
              <span style={{ color: tooltip.side === "left" ? "#073dab" : "#1544a2" }}>
                {tooltip.side === "left" ? "左脚" : "右脚"}
              </span>
              <span className="ml-2" style={{ color: "#757c8a" }}>[{tooltip.row}, {tooltip.col}]</span>
            </div>
            <div className="font-mono" style={{ color: "#d6336c" }}>ADC: {tooltip.value}</div>
          </div>
        )}

        {/* 缩放 + 操作提示 */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 z-10 pointer-events-none">
          <div
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono"
            style={{ background: "rgba(255,255,255,0.9)", border: "1px solid #c4d3f2", boxShadow: "0 1px 4px rgba(50,93,180,0.12)" }}
          >
            <span style={{ color: "#757c8a" }}>缩放</span>
            <span className="font-semibold" style={{ color: "#3d3d3d" }}>{Math.round(scale * 100)}%</span>
          </div>
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px]"
            style={{ background: "rgba(255,255,255,0.7)", color: "#757c8a" }}
          >
            <Move className="w-3 h-3" />
            <span>拖动平移 · 滚轮缩放</span>
          </div>
        </div>
      </div>
    </div>
  );
}
