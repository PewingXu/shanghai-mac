import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useApp } from "@/contexts/AppContext";
import FeetModel3D from "@/components/FeetModel3D";
import Pressure2DHeatmap from "@/components/Pressure2DHeatmap";
import TopNavBar from "@/components/TopNavBar";
import { SerialService } from "@/lib/SerialService";
import { broadcastException, classifySerialError } from "@/components/ExceptionModal";

// 单个传感点面积：传感器 7mm 间距 → 0.7cm × 0.7cm ≈ 0.49 cm²
const CELL_AREA_CM2 = 0.49;
// 指标 UI 刷新节流（约 12fps，避免每帧 setState）
const METRIC_UI_INTERVAL_MS = 80;
const EMPTY_METRICS = { realtime: 0, average: 0, peak: 0, total: 0 };

/** 广播设备连接状态（localStorage + 事件），供其它页面/弹窗读取，保持全局一致 */
function broadcastDeviceStatus(connected: boolean) {
  try {
    window.localStorage.setItem("aciki-device-connected", connected ? "true" : "false");
    window.dispatchEvent(new CustomEvent("aciki-device-status", { detail: { connected } }));
  } catch {
    /* ignore */
  }
}

type CollectState = "idle" | "collecting" | "done";

const TOTAL_DURATION_MS = 30000;
const TOTAL_DURATION_SECONDS = 30;
const COUNTDOWN_RADIUS = 34;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;
const COUNTDOWN_ARC_LENGTH = COUNTDOWN_CIRCUMFERENCE * 0.75;
const COUNTDOWN_DASH_OFFSET = 0;
const MODEL_SCALE_DEFAULT = 2.4;
const MODEL_SCALE_STEP = 0.14;
const MODEL_SCALE_MIN = 1.7;
const MODEL_SCALE_MAX = 3.66;

const HOME_ASSETS = {
  deviceConnected: "/assets/icons/home-page/device-connected.svg",
  deviceDisconnected: "/assets/icons/home-page/device-disconnected.svg",
};

const MEASURE_ASSETS = {
  mode3d: "/assets/icons/realtime-pressure-page/view-2d-3d.svg",
  plus: "/assets/icons/realtime-pressure-page/zoom-in.svg",
  reset: "/assets/icons/realtime-pressure-page/group-1724.svg",
  settings: "/assets/icons/realtime-pressure-page/adjust-params.svg",
  zoomOut: "/assets/icons/realtime-pressure-page/zoom-out.svg",
};

type SerialNavigator = Navigator & {
  serial?: EventTarget & {
    getPorts?: () => Promise<unknown[]>;
  };
};

function useDeviceConnectionStatus() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let disposed = false;
    const serial = (navigator as SerialNavigator).serial;

    const updateFromSerial = async () => {
      const stored = window.localStorage.getItem("aciki-device-connected");
      if (stored === "true" || stored === "false") {
        setConnected(stored === "true");
        return;
      }

      if (!serial?.getPorts) return;
      try {
        const ports = await serial.getPorts();
        if (!disposed) setConnected(ports.length > 0);
      } catch {
        if (!disposed) setConnected(false);
      }
    };

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => void updateFromSerial();

    void updateFromSerial();
    serial?.addEventListener("connect", handleConnect);
    serial?.addEventListener("disconnect", handleDisconnect);

    return () => {
      disposed = true;
      serial?.removeEventListener("connect", handleConnect);
      serial?.removeEventListener("disconnect", handleDisconnect);
    };
  }, []);

  return connected;
}

function DeviceStatusBadge({ connected }: { connected?: boolean }) {
  const auto = useDeviceConnectionStatus();
  // 传入的真实连接态优先；否则回退到自动探测
  const isOn = connected ?? auto;

  return (
    <img
      className="measure-device-status"
      src={isOn ? HOME_ASSETS.deviceConnected : HOME_ASSETS.deviceDisconnected}
      alt={isOn ? "设备连接正常" : "设备连接异常"}
    />
  );
}

function PressureScale() {
  return (
    <div className="measure-scale-wrap" aria-label="压力颜色刻度">
      <div className="measure-color-bar" />
    </div>
  );
}

function ParamSlider({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  return (
    <div className="measure-param">
      <div className="measure-param-head">
        <span className="measure-param-title">{label}</span>
        <span className="measure-param-hint">{hint}</span>
      </div>
      <input
        type="range"
        className="measure-param-slider"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(to right, #ff8400 0 ${pct}%, #efe3d6 ${pct}% 100%)`,
        }}
      />
      <div className="measure-param-scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function WaveCard({
  title,
  value,
  unit,
  large = false,
  history,
}: {
  title: string;
  value: number;
  unit: string;
  large?: boolean;
  history?: number[];
}) {
  // 由历史数据生成实时折线路径（无数据时退回一条平缓静态波形）
  const paths = useMemo(() => {
    const W = 320;
    const H = 70;
    const pts = history && history.length > 1 ? history : null;
    if (!pts) {
      return {
        area: "M0 36 C58 12 92 68 150 38 C209 7 245 64 320 14 L320 70 L0 70 Z",
        line: "",
      };
    }
    const n = pts.length;
    const max = Math.max(...pts, 1);
    const coords = pts.map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = H - 6 - Math.max(0, Math.min(1, v / max)) * (H - 14);
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    const line = "M" + coords.join(" L ");
    const area = `${line} L ${W} ${H} L 0 ${H} Z`;
    return { area, line };
  }, [history]);

  return (
    <div className={large ? "measure-card measure-card-large" : "measure-card"}>
      <div className="measure-card-top">
        <span>{title}</span>
        <strong>
          {value} <small>{unit}</small>
        </strong>
      </div>
      {large && (
        <svg className="measure-card-wave" viewBox="0 0 320 70" preserveAspectRatio="none">
          <defs>
            <linearGradient id="measureWaveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd177" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fff1d4" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          <path d={paths.area} fill="url(#measureWaveGradient)" />
          {paths.line && (
            <path
              d={paths.line}
              fill="none"
              stroke="#ff9422"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}

function MetricPanel({
  heading,
  english,
  realtimeLabel,
  values,
  unit,
  history,
}: {
  heading: string;
  english: string;
  realtimeLabel: string;
  values: {
    realtime: number;
    average: number;
    peak: number;
    total: number;
  };
  unit: string;
  history?: number[];
}) {
  return (
    <section className="measure-panel">
      <h2>
        <span>{heading}</span>
        <small>{english}</small>
      </h2>
      <WaveCard large title={realtimeLabel} value={values.realtime} unit={unit} history={history} />
      <div className="measure-card-row">
        <WaveCard title={heading === "受压面积" ? "平均面积" : "平均压力"} value={values.average} unit={unit} />
        <WaveCard title={heading === "受压面积" ? "峰值面积" : "峰值压力"} value={values.peak} unit={unit} />
        <WaveCard title={heading === "受压面积" ? "面积总值" : "压力总值"} value={values.total} unit={unit} />
      </div>
    </section>
  );
}

function ControlButton({
  type,
  active,
  onClick,
}: {
  type: "mode" | "plus" | "minus" | "focus" | "sliders";
  active?: boolean;
  onClick?: () => void;
}) {
  const assetByType: Partial<Record<typeof type, string>> = {
    mode: MEASURE_ASSETS.mode3d,
    plus: MEASURE_ASSETS.plus,
    minus: MEASURE_ASSETS.zoomOut,
    focus: MEASURE_ASSETS.reset,
    sliders: MEASURE_ASSETS.settings,
  };
  const asset = assetByType[type];

  return (
    <button className={active ? "measure-control active" : "measure-control"} type="button" onClick={onClick}>
      {asset && <img src={asset} alt="" aria-hidden="true" />}
    </button>
  );
}

function CountdownButton({
  state,
  seconds,
  progress,
  progressArcRef,
  labelRef,
  onClick,
}: {
  state: CollectState;
  seconds: number;
  progress: number;
  progressArcRef: RefObject<SVGCircleElement | null>;
  labelRef: RefObject<HTMLSpanElement | null>;
  onClick?: () => void;
}) {
  const normalizedProgress = state === "idle" ? 0 : state === "done" ? 1 : Math.max(0.04, progress);
  const displaySeconds = state === "idle" ? TOTAL_DURATION_SECONDS : state === "done" ? 0 : seconds;
  const label =
    state === "done"
      ? "测量完成"
      : state === "collecting"
      ? "停止测量"
      : "开始测量";
  const buttonLabel = state === "idle" ? label : `${label} ${String(displaySeconds).padStart(2, "0")}s`;

  return (
    <button
      className={`measure-countdown-button ${state}`}
      type="button"
      onClick={onClick}
      aria-label={buttonLabel}
    >
      <span className="measure-countdown-ring">
        <svg viewBox="0 0 88 88" aria-hidden="true">
        <defs>
          <linearGradient id="measureCountdownGradient" x1="0" y1="88" x2="88" y2="0">
            <stop offset="0%" stopColor="#ffe8a7" />
            <stop offset="50%" stopColor="#ffb152" />
            <stop offset="100%" stopColor="#ff8500" />
          </linearGradient>
        </defs>
        <circle className="countdown-track" cx="44" cy="44" r={COUNTDOWN_RADIUS} />
        <circle
          ref={progressArcRef}
          className={state === "done" ? "countdown-progress done" : "countdown-progress"}
          cx="44"
          cy="44"
          r={COUNTDOWN_RADIUS}
          strokeDasharray={`${COUNTDOWN_ARC_LENGTH * normalizedProgress} ${COUNTDOWN_CIRCUMFERENCE - COUNTDOWN_ARC_LENGTH * normalizedProgress}`}
          strokeDashoffset={COUNTDOWN_DASH_OFFSET}
        />
        </svg>
        <span className="countdown-core">
          <i />
        </span>
      </span>
      <strong ref={labelRef}>{buttonLabel}</strong>
    </button>
  );
}

export default function MeasurePage({
  onNext,
  onHistory,
}: {
  onNext: () => void;
  onHistory: () => void;
}) {
  const { currentUser } = useApp();
  const [collectState, setCollectState] = useState<CollectState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [modelScale, setModelScale] = useState(MODEL_SCALE_DEFAULT);
  // 视图模式：3d 脚模 / 2d 压力矩阵网格（由 2D/3D 按钮切换）
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  // 参数面板默认收起，点「参数」按钮才弹出
  const [showParams, setShowParams] = useState(false);
  // 采集完成后的"正在生成报告"loading 弹窗
  const [generating, setGenerating] = useState(false);
  // 参数面板：过滤 ADC 噪声(0-25，后续接 SerialService.filterThreshold) / 颜色显示饱和度(0-255)
  const [noiseFilter, setNoiseFilter] = useState(14);
  const [colorLevel, setColorLevel] = useState(128);
  const progressArcRef = useRef<SVGCircleElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedBeforeStartRef = useRef(0);
  const elapsedRef = useRef(0);
  const lastStateSyncRef = useRef(0);

  // ===== 设备连接 + 实时指标（受压面积/压力联动） =====
  const serialRef = useRef<SerialService | null>(null);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [areaData, setAreaData] = useState(EMPTY_METRICS);
  const [pressureData, setPressureData] = useState(EMPTY_METRICS);
  // 实时折线的历史缓冲（最近 ~80 个采样点）
  const [areaHistory, setAreaHistory] = useState<number[]>([]);
  const [pressureHistory, setPressureHistory] = useState<number[]>([]);
  const noiseFilterRef = useRef(noiseFilter);
  const metricAccRef = useRef({ frames: 0, areaSum: 0, areaPeak: 0, pressSum: 0, pressPeak: 0 });
  const lastMetricUiRef = useRef(0);
  const lastFrameUiRef = useRef(0);
  const collectingRef = useRef(false);
  const [latestFrame, setLatestFrame] = useState<number[][] | null>(null);

  // 噪声阈值变化时同步到串口服务（也供帧回调读取）
  useEffect(() => {
    noiseFilterRef.current = noiseFilter;
    if (serialRef.current) serialRef.current.filterThreshold = noiseFilter;
  }, [noiseFilter]);

  // 仅在“采集中”累计并刷新指标；停止/空闲/完成时帧回调不再更新
  useEffect(() => {
    collectingRef.current = collectState === "collecting";
  }, [collectState]);

  // 每帧 64×64 数据 → 算出受压面积与压力（联动）。
  // 「实时」值：连上设备后每帧都跟随；「平均/峰值/总值」：仅采集中累计。
  const handleFrame = (frame: number[][]) => {
    const nowFrame = performance.now();

    // 2D 网格：设备有数据就显示最新帧（节流 ~15fps）
    if (nowFrame - lastFrameUiRef.current >= 66) {
      lastFrameUiRef.current = nowFrame;
      setLatestFrame(frame);
    }

    // 本帧面积/压力
    const threshold = noiseFilterRef.current;
    let sum = 0;
    let active = 0;
    for (let r = 0; r < frame.length; r++) {
      const row = frame[r];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v > threshold) {
          active += 1;
          sum += v;
        }
      }
    }
    const area = active * CELL_AREA_CM2; // cm²
    const pressure = sum; // ADC 总和（压力代理值，后续可标定为 pa）

    // 连上设备即实时累计平均/峰值/总值（开始测量/重新测量会清零重新统计）
    const acc = metricAccRef.current;
    acc.frames += 1;
    acc.areaSum += area;
    acc.pressSum += pressure;
    if (area > acc.areaPeak) acc.areaPeak = area;
    if (pressure > acc.pressPeak) acc.pressPeak = pressure;

    // 节流刷新 UI
    if (nowFrame - lastMetricUiRef.current < METRIC_UI_INTERVAL_MS) return;
    lastMetricUiRef.current = nowFrame;

    const n = acc.frames || 1;
    setAreaData({
      realtime: Math.round(area),
      average: Math.round(acc.areaSum / n),
      peak: Math.round(acc.areaPeak),
      total: Math.round(acc.areaPeak),
    });
    setPressureData({
      realtime: Math.round(pressure),
      average: Math.round(acc.pressSum / n),
      peak: Math.round(acc.pressPeak),
      total: Math.round(acc.pressSum),
    });
    setAreaHistory((h) => [...(h.length >= 80 ? h.slice(-79) : h), Math.round(area)]);
    setPressureHistory((h) => [...(h.length >= 80 ? h.slice(-79) : h), Math.round(pressure)]);
  };

  const resetMetrics = () => {
    metricAccRef.current = { frames: 0, areaSum: 0, areaPeak: 0, pressSum: 0, pressPeak: 0 };
    lastMetricUiRef.current = 0;
    setAreaData(EMPTY_METRICS);
    setPressureData(EMPTY_METRICS);
    setAreaHistory([]);
    setPressureHistory([]);
  };

  const connectDevice = async () => {
    if (connecting) return;
    if (deviceConnected) {
      await serialRef.current?.disconnect();
      setDeviceConnected(false);
      broadcastDeviceStatus(false);
      return;
    }
    setConnecting(true);
    try {
      if (!serialRef.current) {
        const service = new SerialService();
        service.setOnData(handleFrame);
        // 已连接后中途掉线 → 弹"连接异常"
        service.setOnError(() => {
          setDeviceConnected(false);
          broadcastDeviceStatus(false);
          broadcastException("port-error");
        });
        serialRef.current = service;
      }
      serialRef.current.filterThreshold = noiseFilterRef.current;
      const ok = await serialRef.current.connect();
      setDeviceConnected(ok);
      broadcastDeviceStatus(ok);
    } catch (err) {
      // 连接失败：按错误类型弹出对应异常弹窗
      setDeviceConnected(false);
      broadcastDeviceStatus(false);
      broadcastException(classifySerialError(err));
    } finally {
      setConnecting(false);
    }
  };

  // 卸载时断开串口
  useEffect(() => {
    return () => {
      void serialRef.current?.disconnect();
      broadcastDeviceStatus(false); // 离开测量页即视为断开，清除全局状态
    };
  }, []);

  // 采集完成 → 弹"正在生成报告"loading，稍后自动跳转报告页
  useEffect(() => {
    if (collectState !== "done") return;
    setGenerating(true);
    const timer = window.setTimeout(() => onNext(), 2200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectState]);

  useEffect(() => {
    const lockedElements = [
      document.documentElement,
      document.body,
      document.getElementById("root"),
    ].filter((element): element is HTMLElement => Boolean(element));

    const previousStyles = lockedElements.map((element) => ({
      element,
      overflow: element.style.overflow,
      width: element.style.width,
      height: element.style.height,
    }));

    lockedElements.forEach((element) => {
      element.style.overflow = "hidden";
      element.style.width = "100%";
      element.style.height = "100%";
    });

    return () => {
      previousStyles.forEach(({ element, overflow, width, height }) => {
        element.style.overflow = overflow;
        element.style.width = width;
        element.style.height = height;
      });
    };
  }, []);

  const progress = collectState === "done" ? 1 : Math.min(elapsedMs / TOTAL_DURATION_MS, 1);
  const remaining = Math.max(0, Math.ceil((TOTAL_DURATION_MS - elapsedMs) / 1000));

  const syncCountdownVisual = (elapsed: number, state: CollectState) => {
    const p = state === "done" ? 1 : Math.min(Math.max(elapsed / TOTAL_DURATION_MS, 0), 1);
    const visibleLength = COUNTDOWN_ARC_LENGTH * p;
    progressArcRef.current?.setAttribute(
      "stroke-dasharray",
      `${visibleLength} ${COUNTDOWN_CIRCUMFERENCE - visibleLength}`,
    );

    if (labelRef.current) {
      const seconds = Math.max(0, Math.ceil((TOTAL_DURATION_MS - elapsed) / 1000));
      const prefix =
        state === "done"
          ? "测量完成"
          : state === "collecting"
          ? "停止测量"
          : "开始测量";
      labelRef.current.textContent =
        state === "idle" ? prefix : `${prefix} ${String(seconds).padStart(2, "0")}s`;
    }
  };

  const stopRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const runCollectingFrame = (now: number) => {
    if (startedAtRef.current === null) startedAtRef.current = now;
    const elapsed = Math.min(
      elapsedBeforeStartRef.current + now - startedAtRef.current,
      TOTAL_DURATION_MS,
    );

    elapsedRef.current = elapsed;
    syncCountdownVisual(elapsed, elapsed >= TOTAL_DURATION_MS ? "done" : "collecting");

    if (now - lastStateSyncRef.current > 120 || elapsed >= TOTAL_DURATION_MS) {
      lastStateSyncRef.current = now;
      setElapsedMs(elapsed);
    }

    if (elapsed >= TOTAL_DURATION_MS) {
      stopRaf();
      setCollectState("done");
      setElapsedMs(TOTAL_DURATION_MS);
      return;
    }

    rafRef.current = requestAnimationFrame(runCollectingFrame);
  };

  useEffect(() => {
    syncCountdownVisual(elapsedMs, collectState);
  }, [collectState, elapsedMs]);

  useEffect(() => {
    return () => stopRaf();
  }, []);

  const handleCollectClick = () => {
    if (collectState === "done") {
      onNext();
      return;
    }

    // 采集中 → 再按直接停止并清零（中断）
    if (collectState === "collecting") {
      resetCollecting();
      return;
    }

    // 空闲 → 重新开始一次采集
    elapsedBeforeStartRef.current = 0;
    elapsedRef.current = 0;
    setElapsedMs(0);
    resetMetrics();
    startedAtRef.current = null;
    setCollectState("collecting");
    rafRef.current = requestAnimationFrame(runCollectingFrame);
  };

  const resetCollecting = () => {
    stopRaf();
    startedAtRef.current = null;
    elapsedBeforeStartRef.current = 0;
    elapsedRef.current = 0;
    setElapsedMs(0);
    setCollectState("idle");
    resetMetrics();
  };

  const zoomModel = (direction: 1 | -1) => {
    setModelScale((value) => {
      const nextValue = value + direction * MODEL_SCALE_STEP;
      return Math.min(MODEL_SCALE_MAX, Math.max(MODEL_SCALE_MIN, Number(nextValue.toFixed(2))));
    });
  };

  const resetModelView = () => {
    setModelScale(MODEL_SCALE_DEFAULT);
  };

  return (
    <div className="measure-shell">
      <div className="measure-grid-bg" />
      <TopNavBar currentStep={2} onHistoryClick={onHistory} transparent />

      <main className="measure-main">
        <section className="measure-stage">
          <header className="measure-title">
            <div>
              <h1>实时压力展示</h1>
              <span>Real-time Pressure Monitoring</span>
            </div>
          </header>

          <div className="measure-visual">
            <PressureScale />

            <div
              className="measure-model"
              style={{ pointerEvents: viewMode === "2d" ? "auto" : "none" }}
            >
              {viewMode === "3d" ? (
                <FeetModel3D
                  width="100%"
                  height="100%"
                  modelScale={modelScale}
                  lockedView
                  pressureData={latestFrame}
                  heatVmax={colorLevel}
                />
              ) : (
                <Pressure2DHeatmap realtimeData={latestFrame} vmax={colorLevel} />
              )}
            </div>

            {showParams && (
              <div className="measure-control-panel">
                <ParamSlider
                  label="过滤ADC噪声"
                  hint="信号平滑程度"
                  min={0}
                  max={50}
                  value={noiseFilter}
                  onChange={setNoiseFilter}
                />
                <div className="measure-param-divider" />
                <ParamSlider
                  label="颜色显示"
                  hint="颜色饱和程度"
                  min={0}
                  max={255}
                  value={colorLevel}
                  onChange={setColorLevel}
                />
              </div>
            )}

            <div className="measure-controls">
              <ControlButton
                type="mode"
                active={viewMode === "2d"}
                onClick={() => setViewMode((v) => (v === "3d" ? "2d" : "3d"))}
              />
              <ControlButton type="plus" onClick={() => zoomModel(1)} />
              <ControlButton type="minus" onClick={() => zoomModel(-1)} />
              <ControlButton type="focus" onClick={resetModelView} />
              <ControlButton
                type="sliders"
                active={showParams}
                onClick={() => setShowParams((v) => !v)}
              />
            </div>
          </div>

          <div className="measure-countdown-row">
            <CountdownButton
              state={collectState}
              seconds={remaining}
              progress={progress}
              progressArcRef={progressArcRef}
              labelRef={labelRef}
              onClick={handleCollectClick}
            />
          </div>
        </section>

        <aside className="measure-sidebar">
          <MetricPanel
            heading="受压面积"
            english="Pressure Contact Area"
            realtimeLabel="实时面积"
            values={areaData}
            unit="cm²"
            history={areaHistory}
          />
          <MetricPanel
            heading="压力"
            english="Pressure"
            realtimeLabel="实时压力"
            values={pressureData}
            unit="pa"
            history={pressureHistory}
          />
        </aside>
      </main>

      <footer className="measure-footer">
        <div className="measure-footer-left">
          <DeviceStatusBadge connected={deviceConnected} />
          <button
            className="measure-connect-btn"
            type="button"
            onClick={connectDevice}
            disabled={connecting}
          >
            {connecting ? "连接中…" : deviceConnected ? "断开设备" : "连接设备"}
          </button>
        </div>
        <div className="measure-footer-right">
          <span className="measure-current-user">
            当前用户：{currentUser?.name ?? "果果"}（ID:{currentUser?.id ?? "1234"}）
          </span>
          <button onClick={resetCollecting}>重新测量</button>
          <button className="primary-link" onClick={onNext}>
            结束体验
          </button>
        </div>
      </footer>

      {generating && (
        <div className="measure-loading-overlay">
          <div className="measure-loading-card">
            <img
              className="measure-loading-spinner"
              src="/assets/icons/realtime-pressure-page/loading-spinner.svg"
              alt=""
              aria-hidden="true"
            />
            <p>采集完成，正在生成报告请稍等…</p>
          </div>
        </div>
      )}

      <style>{measureStyles}</style>
    </div>
  );
}

const measureStyles = `
  .measure-shell {
    --measure-pad-x: clamp(28px, 4.2vw, 78px);
    --measure-pad-top: clamp(82px, 9.4vh, 112px);
    --measure-footer-h: clamp(60px, 7vh, 76px);
    --measure-gap: clamp(26px, 3vw, 54px);
    --measure-sidebar-w: clamp(386px, 28.5vw, 540px);
    position: relative;
    width: 100vw;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(255, 250, 240, 0.98) 0%, rgba(255, 255, 255, 0.98) 66%, #ffffff 100%),
      #fffdf8;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    color: #1f1f1f;
  }

  html:has(.measure-shell),
  body:has(.measure-shell),
  #root:has(.measure-shell) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .measure-grid-bg {
    position: fixed;
    left: -18vw;
    right: -18vw;
    top: 150px;
    bottom: -42vh;
    pointer-events: none;
    background:
      linear-gradient(rgba(184, 177, 166, 0.3) 1px, transparent 1px),
      linear-gradient(90deg, rgba(184, 177, 166, 0.28) 1px, transparent 1px);
    background-size: 40px 40px;
    transform-origin: center top;
    transform: perspective(1180px) rotateX(54deg) translateY(12px) scaleX(1.04) scaleY(1.04);
    opacity: 0.48;
    z-index: 0;
  }

  .measure-grid-bg::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 250, 240, 0.92) 0%, rgba(255, 250, 240, 0.18) 28%, rgba(255, 255, 255, 0) 70%);
    pointer-events: none;
  }

  .measure-main {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--measure-sidebar-w);
    gap: var(--measure-gap);
    width: 100%;
    max-width: 1760px;
    height: 100vh;
    min-height: 0;
    max-height: 100vh;
    margin: 0 auto;
    padding: var(--measure-pad-top) var(--measure-pad-x) var(--measure-footer-h);
    box-sizing: border-box;
    overflow: hidden;
  }

  .measure-stage {
    position: relative;
    min-width: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .measure-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: clamp(16px, 1.7vw, 28px);
    margin-bottom: clamp(8px, 1vh, 12px);
    min-height: 0;
  }

  .measure-title h1 {
    margin: 0;
    font-size: clamp(21px, 1.36vw, 26px);
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: 0;
  }

  .measure-title span {
    display: block;
    margin-top: 4px;
    font-size: clamp(13px, 0.85vw, 16px);
    font-weight: 700;
  }

  .measure-visual {
    --measure-panel-w: clamp(232px, 17vw, 299px);
    --measure-panel-h: clamp(180px, 21vh, 208px);
    --measure-panel-right: clamp(4px, 1vw, 18px);
    --measure-panel-bottom: clamp(24px, 4.5vh, 60px);
    --measure-control-size: clamp(38px, 2.4vw, 46.3px);
    position: relative;
    height: 100%;
    min-height: 0;
    /* 允许参数面板向下探出到倒计时行右侧空白处（模型已用 top/bottom 自限，不会溢出） */
    overflow: visible;
  }

  .measure-control-panel {
    position: absolute;
    right: var(--measure-panel-right);
    bottom: var(--measure-panel-bottom);
    width: var(--measure-panel-w);
    height: var(--measure-panel-h);
    border-radius: 10px;
    background: #ffffff;
    border: 1px solid #f79831;
    box-sizing: border-box;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(10px, 1.4vh, 14px);
    padding: clamp(14px, 1.8vh, 18px) clamp(16px, 1.3vw, 22px);
    box-shadow: 0 6px 18px rgba(220, 150, 80, 0.12);
  }

  .measure-param {
    display: grid;
    gap: clamp(5px, 0.7vh, 8px);
  }

  .measure-param-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .measure-param-title {
    font-size: clamp(14px, 0.95vw, 17px);
    font-weight: 800;
    color: #17191c;
    white-space: nowrap;
  }

  .measure-param-hint {
    font-size: clamp(10px, 0.66vw, 12px);
    font-weight: 500;
    color: #b3a392;
    white-space: nowrap;
  }

  .measure-param-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: clamp(14px, 1vw, 18px);
    border-radius: 999px;
    outline: none;
    cursor: pointer;
  }

  .measure-param-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: clamp(16px, 1.2vw, 20px);
    height: clamp(16px, 1.2vw, 20px);
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(160, 91, 28, 0.35);
    cursor: pointer;
  }

  .measure-param-slider::-moz-range-thumb {
    width: clamp(16px, 1.2vw, 20px);
    height: clamp(16px, 1.2vw, 20px);
    border: none;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(160, 91, 28, 0.35);
    cursor: pointer;
  }

  .measure-param-scale {
    display: flex;
    justify-content: space-between;
    font-size: clamp(11px, 0.72vw, 13px);
    font-weight: 600;
    color: #6b6256;
  }

  .measure-param-divider {
    height: 1px;
    background: rgba(203, 161, 115, 0.3);
  }

  .measure-scale-wrap {
    position: absolute;
    left: 0;
    top: clamp(72px, 12vh, 132px);
    width: clamp(22px, 1.6vw, 30px);
    height: clamp(285px, 41vh, 430px);
  }

  .measure-color-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: clamp(13px, 0.95vw, 18px);
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(180deg, #ff8282 0%, #ff8400 19%, #ffc758 39%, #d1ffa4 61%, #6bcbff 100%);
    box-shadow: 0 10px 24px rgba(255, 132, 0, 0.14);
  }

  .measure-model {
    position: absolute;
    left: clamp(40px, 4.8vw, 92px);
    right: clamp(40px, 4.8vw, 92px);
    top: 0px;
    /* 用 bottom 而非定高：模型始终被限制在可视区内，小屏也不会溢出 */
    bottom: clamp(8px, 1.4vh, 20px);
    pointer-events: none;
  }

  .measure-controls {
    position: absolute;
    right: calc(var(--measure-panel-right) + clamp(46px, 3.9vw, 76px));
    /* 落在参数面板正上方：面板底 + 面板高 + 间距 */
    bottom: calc(var(--measure-panel-bottom) + var(--measure-panel-h) + clamp(10px, 1.4vh, 18px));
    display: grid;
    gap: clamp(7px, 0.55vw, 10px);
    z-index: 5;
  }

  .measure-control {
    width: var(--measure-control-size);
    height: var(--measure-control-size);
    border: 1px solid #f79831;
    border-radius: 6px;
    background: #fff4e8;
    color: #f79831;
    font-size: 15px;
    font-weight: 800;
    line-height: 1;
    box-shadow: none;
    overflow: hidden;
    display: grid;
    place-items: center;
    padding: 0;
  }

  .measure-control.active {
    color: #f79831;
    background: #fff4e8;
    box-shadow: none;
  }

  .measure-control img {
    display: block;
    width: calc(100% + 2px);
    height: calc(100% + 2px);
    margin: -1px;
    object-fit: cover;
  }

  .measure-plus-icon,
  .measure-minus-icon {
    position: relative;
    width: 27px;
    height: 27px;
    display: block;
  }

  .measure-plus-icon::before,
  .measure-plus-icon::after,
  .measure-minus-icon::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 27px;
    height: 5px;
    border-radius: 999px;
    background: #ff9828;
    transform: translate(-50%, -50%);
  }

  .measure-plus-icon::after {
    width: 5px;
    height: 27px;
  }

  .measure-focus-icon {
    width: 30px;
    height: 30px;
    border: 5px solid #ded1c3;
    border-radius: 999px;
    box-sizing: border-box;
    box-shadow: 0 0 0 7px rgba(222, 209, 195, 0.4);
  }

  .measure-sliders-icon {
    position: relative;
    width: 30px;
    height: 28px;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
  }

  .measure-sliders-icon::before,
  .measure-sliders-icon::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(#ff9828, #ff9828) 4px 0 / 4px 100% no-repeat,
      linear-gradient(#ff9828, #ff9828) 13px 0 / 4px 100% no-repeat,
      linear-gradient(#ff9828, #ff9828) 22px 0 / 4px 100% no-repeat;
  }

  .measure-sliders-icon::after {
    background:
      radial-gradient(circle, #fff4e8 0 5px, #ff9828 5px 8px, transparent 8px) 4px 8px / 16px 16px no-repeat,
      radial-gradient(circle, #fff4e8 0 5px, #ff9828 5px 8px, transparent 8px) 13px 16px / 16px 16px no-repeat,
      radial-gradient(circle, #fff4e8 0 5px, #ff9828 5px 8px, transparent 8px) 22px 7px / 16px 16px no-repeat;
  }

  .measure-countdown-row {
    position: absolute;
    left: 50%;
    bottom: clamp(4px, 1.2vh, 16px);
    transform: translateX(-50%);
    z-index: 6;
  }

  .measure-countdown-button {
    position: relative;
    width: clamp(128px, 9vw, 174px);
    min-height: clamp(96px, 12vh, 150px);
    border: 0;
    background: transparent;
    display: grid;
    place-items: center;
    gap: 8px;
    color: #5a3a1a;
    padding: 0;
    cursor: pointer;
  }

  .measure-countdown-ring {
    position: relative;
    width: clamp(88px, 6.15vw, 118px);
    height: clamp(88px, 6.15vw, 118px);
    display: grid;
    place-items: center;
  }

  .measure-countdown-button svg {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    transform: rotate(135deg);
    transform-origin: 50% 50%;
  }

  .measure-countdown-button.collecting svg {
    animation: measure-pulse-glow 1.6s ease-in-out infinite;
  }

  .countdown-track,
  .countdown-progress {
    fill: none;
    stroke-width: clamp(6px, 0.42vw, 8px);
  }

  .countdown-track {
    stroke: rgba(180, 160, 130, 0.35);
    stroke-linecap: round;
    stroke-dasharray: 169.65 56.55;
  }

  .countdown-progress {
    stroke: url(#measureCountdownGradient);
    stroke-linecap: round;
    transition: stroke-dasharray 260ms ease;
  }

  .countdown-progress.done {
    stroke: #ff8a00;
  }

  .countdown-core {
    position: relative;
    z-index: 2;
    width: clamp(50px, 3.55vw, 68px);
    height: clamp(50px, 3.55vw, 68px);
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(200, 180, 150, 0.52);
    transition: background 180ms ease, box-shadow 180ms ease;
  }

  .measure-countdown-button.collecting .countdown-core,
  .measure-countdown-button.paused .countdown-core,
  .measure-countdown-button.done .countdown-core {
    background: #f5a623;
    box-shadow: 0 4px 14px rgba(245, 166, 35, 0.28);
  }

  .countdown-core i {
    width: clamp(18px, 1.25vw, 24px);
    height: clamp(18px, 1.25vw, 24px);
    border-radius: clamp(3px, 0.22vw, 4px);
    background: rgba(150, 120, 80, 0.82);
    display: block;
  }

  .measure-countdown-button.collecting .countdown-core i,
  .measure-countdown-button.paused .countdown-core i,
  .measure-countdown-button.done .countdown-core i {
    background: #ffffff;
  }

  .measure-countdown-button strong {
    position: relative;
    z-index: 2;
    font-size: clamp(14px, 0.94vw, 18px);
    font-weight: 800;
    white-space: nowrap;
    line-height: 1.3;
    color: #5a3a1a;
  }

  @keyframes measure-pulse-glow {
    0% { filter: drop-shadow(0 0 0 rgba(245, 166, 35, 0.6)); }
    50% { filter: drop-shadow(0 0 8px rgba(245, 166, 35, 0.82)); }
    100% { filter: drop-shadow(0 0 0 rgba(245, 166, 35, 0.6)); }
  }

  .measure-sidebar {
    display: grid;
    align-content: start;
    gap: clamp(22px, 4.2vh, 62px);
    padding-top: clamp(38px, 7vh, 98px);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .measure-panel h2 {
    display: flex;
    align-items: baseline;
    gap: clamp(12px, 1.18vw, 22px);
    margin: 0 0 clamp(12px, 1.5vh, 18px);
  }

  .measure-panel h2 span {
    font-size: clamp(22px, 1.46vw, 28px);
    font-weight: 700;
    color: #17191c;
  }

  .measure-panel h2 small {
    font-size: clamp(12px, 0.83vw, 16px);
    font-weight: 600;
    color: #6b6256;
  }

  .measure-card {
    min-height: clamp(84px, 9.63vh, 104px);
    border: 1px solid #ffbf7b;
    border-radius: 12px;
    background: linear-gradient(180deg, #ffffff 50%, #fff3de 100%);
    box-shadow: 0 2px 6px rgba(220, 185, 146, 0.4);
    overflow: hidden;
    box-sizing: border-box;
  }

  .measure-card:not(.measure-card-large) {
    display: flex;
    flex-direction: column;
  }

  .measure-card-large {
    height: clamp(136px, 15.74vh, 170px);
    margin-bottom: clamp(8px, 1.1vh, 12px);
    background: rgba(255, 255, 255, 0.94);
  }

  .measure-card-top {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: clamp(12px, 1.05vw, 20px);
    padding: clamp(24px, 3.1vh, 34px) clamp(20px, 1.67vw, 32px) 0;
  }

  .measure-card:not(.measure-card-large) .measure-card-top {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    text-align: center;
    gap: clamp(3px, 0.5vh, 6px);
    padding: 0 8px;
  }

  .measure-card-top span {
    color: #17191c;
    font-size: clamp(18px, 1.25vw, 24px);
    font-weight: 700;
  }

  .measure-card:not(.measure-card-large) .measure-card-top span {
    order: 2;
    margin-top: 0;
    color: #6b6256;
    font-size: clamp(12px, 0.78vw, 15px);
    font-weight: 500;
  }

  .measure-card-top strong {
    color: #17191c;
    font-size: clamp(20px, 1.25vw, 24px);
    font-weight: 800;
  }

  .measure-card-top small {
    font-size: clamp(13px, 0.83vw, 16px);
    font-weight: 600;
    color: #8a8275;
  }

  .measure-card:not(.measure-card-large) .measure-card-top strong {
    font-size: clamp(18px, 1.04vw, 20px);
  }

  .measure-card-wave {
    width: 100%;
    height: clamp(58px, 7.4vh, 80px);
    margin-top: clamp(10px, 1.5vh, 16px);
    display: block;
  }

  .measure-card-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: clamp(7px, 0.48vw, 9px);
  }

  .measure-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(90, 65, 35, 0.32);
    backdrop-filter: blur(2px);
    animation: measure-loading-fade 180ms ease-out;
  }

  .measure-loading-card {
    display: grid;
    justify-items: center;
    gap: clamp(16px, 2.4vh, 26px);
    width: min(420px, calc(100vw - 64px));
    padding: clamp(30px, 4.5vh, 44px) clamp(28px, 2.6vw, 40px);
    border-radius: 14px;
    background: linear-gradient(180deg, #fff8ec 0%, #fdeed8 100%);
    border: 1px solid #f6a44c;
    box-shadow: 0 24px 70px rgba(160, 100, 40, 0.3);
    animation: measure-loading-pop 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .measure-loading-spinner {
    width: clamp(56px, 5vw, 76px);
    height: auto;
    animation: measure-loading-spin 1.1s linear infinite;
  }

  .measure-loading-card p {
    margin: 0;
    color: #3a2d1c;
    font-size: clamp(15px, 1vw, 18px);
    font-weight: 700;
  }

  @keyframes measure-loading-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes measure-loading-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes measure-loading-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .measure-footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 12;
    height: var(--measure-footer-h);
    display: grid;
    grid-template-columns: minmax(150px, 260px) minmax(0, auto);
    justify-content: space-between;
    align-items: center;
    padding: 0 var(--measure-pad-x);
    box-sizing: border-box;
    background: transparent;
  }

  .measure-footer-left,
  .measure-footer-right {
    display: flex;
    align-items: center;
    gap: clamp(12px, 1.15vw, 22px);
  }

  .measure-device-status {
    width: clamp(104px, 7.1vw, 136px);
    height: auto;
    display: block;
  }

  .measure-connect-btn {
    border: 1px solid #f79831;
    background: #fff4e8;
    color: #f08614;
    border-radius: 8px;
    padding: clamp(6px, 0.6vh, 9px) clamp(12px, 1vw, 18px);
    font-size: clamp(12px, 0.83vw, 15px);
    font-weight: 700;
    white-space: nowrap;
    transition: background 160ms ease, transform 160ms ease;
  }

  .measure-connect-btn:hover {
    background: #ffe9d2;
  }

  .measure-connect-btn:active {
    transform: scale(0.97);
  }

  .measure-connect-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .measure-footer-right span {
    font-size: clamp(12px, 0.83vw, 16px);
    font-weight: 800;
    color: #3d3d3d;
    white-space: nowrap;
  }

  .measure-footer-right button {
    border: 0;
    background: transparent;
    color: #3d3d3d;
    text-decoration: underline;
    text-underline-offset: 4px;
    font-size: clamp(12px, 0.83vw, 16px);
    font-weight: 800;
    white-space: nowrap;
  }

  .measure-footer-right .primary-link {
    color: #ff8400;
  }

  @media (max-width: 1400px) {
    .measure-shell {
      --measure-pad-x: clamp(24px, 3.2vw, 44px);
      --measure-sidebar-w: clamp(330px, 31vw, 410px);
      --measure-gap: clamp(18px, 2.2vw, 30px);
    }

    .measure-main {
      grid-template-columns: minmax(0, 1fr) var(--measure-sidebar-w);
    }

    .measure-visual {
      --measure-panel-w: clamp(216px, 18vw, 252px);
      --measure-panel-h: clamp(174px, 20vh, 198px);
      --measure-panel-right: clamp(2px, 0.7vw, 12px);
    }

    .measure-model {
      left: clamp(34px, 4vw, 70px);
      right: clamp(34px, 4vw, 70px);
      bottom: clamp(8px, 1.4vh, 20px);
    }
  }

  @media (max-width: 1120px) {
    .measure-shell {
      --measure-pad-x: clamp(18px, 2.2vw, 26px);
      --measure-pad-top: clamp(78px, 8.6vh, 94px);
      --measure-sidebar-w: clamp(270px, 29vw, 320px);
      --measure-gap: clamp(12px, 1.6vw, 18px);
      --measure-footer-h: clamp(54px, 6.4vh, 66px);
    }

    .measure-main {
      grid-template-columns: minmax(0, 1fr) var(--measure-sidebar-w);
    }

    .measure-stage {
      grid-template-rows: auto minmax(0, 1fr);
    }

    .measure-title {
      gap: 10px;
    }

    .measure-title h1 {
      font-size: clamp(18px, 1.9vw, 21px);
    }

    .measure-title span {
      font-size: clamp(11px, 1.2vw, 13px);
    }

    .measure-visual {
      --measure-panel-w: clamp(180px, 19vw, 220px);
      --measure-panel-h: clamp(168px, 22vh, 186px);
      --measure-panel-right: clamp(2px, 0.6vw, 10px);
      --measure-control-size: clamp(34px, 3.2vw, 38px);
    }

    .measure-model {
      left: clamp(26px, 3.4vw, 52px);
      right: clamp(26px, 3.4vw, 52px);
      bottom: clamp(6px, 1.2vh, 16px);
    }

    .measure-countdown-row {
      transform: translateX(-50%);
    }

    .measure-sidebar {
      grid-template-columns: 1fr;
      gap: clamp(12px, 2.4vh, 22px);
      padding-top: clamp(28px, 5vh, 48px);
    }

    .measure-panel h2 {
      margin-bottom: 8px;
    }

    .measure-card-large {
      height: clamp(110px, 14vh, 136px);
    }

    .measure-card {
      min-height: clamp(70px, 8.6vh, 86px);
    }

    .measure-card-wave {
      height: clamp(44px, 6vh, 62px);
      margin-top: 6px;
    }

    .measure-card-top {
      padding: clamp(16px, 2vh, 22px) clamp(12px, 1.4vw, 18px) 0;
    }

    .measure-card:not(.measure-card-large) .measure-card-top {
      padding-top: clamp(14px, 1.9vh, 20px);
    }

    .measure-footer {
      grid-template-columns: minmax(120px, auto) minmax(0, 1fr);
    }

    .measure-footer-right {
      justify-content: flex-end;
      gap: 12px;
      min-width: 0;
    }

    .measure-footer-right span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  @media (max-width: 760px) {
    .measure-shell {
      --measure-pad-x: 12px;
      --measure-pad-top: 74px;
      --measure-sidebar-w: 220px;
      --measure-gap: 10px;
      --measure-footer-h: 54px;
    }

    .measure-main {
      grid-template-columns: minmax(0, 1fr) var(--measure-sidebar-w);
    }

    .measure-visual {
      --measure-panel-w: 168px;
      --measure-panel-h: 170px;
      --measure-panel-right: 4px;
      --measure-panel-bottom: 40px;
    }

    .measure-model {
      left: 40px;
      right: 40px;
      top: 6px;
      bottom: clamp(6px, 1vh, 14px);
    }

    .measure-controls {
      right: 22px;
      bottom: 42px;
      gap: 5px;
    }

    .measure-scale-wrap {
      top: 36px;
      height: clamp(210px, 38vh, 250px);
    }

    .measure-sidebar {
      gap: 10px;
      padding-top: 20px;
    }

    .measure-card-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }

    .measure-panel h2 {
      gap: 7px;
    }

    .measure-panel h2 span {
      font-size: 17px;
    }

    .measure-panel h2 small {
      font-size: 10px;
    }

    .measure-card-top span {
      font-size: 14px;
    }

    .measure-card-top strong {
      font-size: 16px;
    }

    .measure-card:not(.measure-card-large) .measure-card-top span {
      font-size: 10px;
    }

    .measure-card:not(.measure-card-large) .measure-card-top strong {
      font-size: 15px;
    }

    .measure-footer {
      height: var(--measure-footer-h);
      grid-template-columns: 104px minmax(0, 1fr);
    }

    .measure-footer-left,
    .measure-footer-right {
      flex-wrap: nowrap;
      gap: 8px;
    }

    .measure-footer-right button {
      display: none;
    }
  }
`;
