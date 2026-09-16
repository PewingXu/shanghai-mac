import { useEffect, useRef, useState, type RefObject } from "react";
import { useApp } from "@/contexts/AppContext";
import FeetModel3D from "@/components/FeetModel3D";
import Pressure2DHeatmap from "@/components/Pressure2DHeatmap";
import BrandLogo from "@/components/BrandLogo";
import HistoryLink from "@/components/HistoryLink";
import PortPickerModal from "@/components/PortPickerModal";
import { toast } from "sonner";
import { deviceManager } from "@/lib/deviceManager";
import { parseCollectionFile, reshapeFrame } from "@/lib/collectionData";
import { broadcastException, classifySerialError } from "@/components/ExceptionModal";
import { analyzePython, type PythonAnalysisResult } from "@/lib/pythonApi";
import { computeMliLine } from "@/lib/mli";
import { adcToKpa, CELL_AREA_M2 } from "@/lib/pressureCalib";
import type { MeasureAnalysis } from "@/contexts/AppContext";

// 单个传感点面积：传感器 7mm 间距 → 0.7cm × 0.7cm ≈ 0.49 cm²
const CELL_AREA_CM2 = 0.49;
// 指标 UI 刷新节流（约 12fps，避免每帧 setState）
const METRIC_UI_INTERVAL_MS = 80;
const EMPTY_METRICS = { realtime: 0, average: 0, peak: 0, total: 0 };
/** 一位小数四舍五入（kPa / N 这类物理量整数太粗、两位又晃眼） */
const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 对整段采集帧做前端补充统计：平均帧 → 左右脚 MLI、左右 ADC 总和与接触面积。
 * display 变换与 2D 网格一致（display[r][c]=raw[c][r]，左脚列 0-31 / 右脚 32-63）。
 */
function summarizeFrames(frames: number[][]) {
  if (frames.length === 0) return null;
  const n = frames.length;
  const avg = new Float64Array(4096);
  for (const f of frames) for (let i = 0; i < 4096; i++) avg[i] += f[i];
  for (let i = 0; i < 4096; i++) avg[i] /= n;
  const display: number[][] = Array.from({ length: 64 }, (_, r) =>
    Array.from({ length: 64 }, (_, c) => avg[c * 64 + r]),
  );
  let lp = 0, rp = 0, la = 0, ra = 0;
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      const v = display[r][c];
      if (v > 1) {
        if (c < 32) { lp += v; la += 1; } else { rp += v; ra += 1; }
      }
    }
  }
  const mliL = computeMliLine(display, 0, 32, "left");
  const mliR = computeMliLine(display, 32, 64, "right");
  return {
    mli: {
      left: mliL && mliL.lateralSum > 0 ? mliL.medialSum / mliL.lateralSum : null,
      right: mliR && mliR.lateralSum > 0 ? mliR.medialSum / mliR.lateralSum : null,
    },
    frontend: {
      leftPressure: Math.round(lp),
      rightPressure: Math.round(rp),
      leftArea: Math.round(la * CELL_AREA_CM2),
      rightArea: Math.round(ra * CELL_AREA_CM2),
    },
  };
}

// ===== 后台分析任务（模块级单例，切走页面也持续运行） =====
type BgPhase = "idle" | "analyzing";
interface BgListener {
  onPhase?: (phase: BgPhase) => void;
}
const bgJob: { phase: BgPhase; listeners: Set<BgListener> } = {
  phase: "idle",
  listeners: new Set(),
};
function bgEmitPhase() {
  bgJob.listeners.forEach((l) => l.onPhase?.(bgJob.phase));
}
function subscribeBgJob(l: BgListener) {
  bgJob.listeners.add(l);
  return () => {
    bgJob.listeners.delete(l);
  };
}
/** 完成后通过 "aciki-analysis-done" 事件广播结果（Home 兜底入库，测量页在场则跳报告） */
async function runBgAnalysis(frames: number[][]) {
  if (bgJob.phase === "analyzing") return; // 防重
  bgJob.phase = "analyzing";
  bgEmitPhase();
  const minDelay = new Promise((r) => window.setTimeout(r, 1500));
  let python: PythonAnalysisResult | null = null;
  try {
    if (frames.length >= 5) python = await analyzePython(frames);
  } catch (err) {
    console.warn("[report] Python 分析不可用，报告页将回退演示数据：", err);
  }
  const extra = summarizeFrames(frames);
  await minDelay;
  bgJob.phase = "idle";
  bgEmitPhase();
  const detail: MeasureAnalysis = {
    python,
    mli: extra?.mli ?? { left: null, right: null },
    frontend: extra?.frontend ?? null,
    rawFrames: frames, // 原始帧随事件传递：AppContext 持久化为该用户一条记录（仿 sit 格式 CSV 存档）
  };
  window.dispatchEvent(new CustomEvent("aciki-analysis-done", { detail }));
}
type CollectState = "idle" | "collecting" | "done";

const TOTAL_DURATION_MS = 30000; // 实采固定 30s
const TOTAL_DURATION_SECONDS = 30;
/** 导入回放：按足垫实采帧率逐帧送入同一条管线（≈42fps），30s 的数据回放也是 30s；
 *  文件更长只取前 30s，与实采口径一致（分析/落盘体积也可控） */
const REPLAY_FRAME_MS = 24;
const MAX_REPLAY_FRAMES = Math.round(TOTAL_DURATION_MS / REPLAY_FRAME_MS);
// 舞台整幅宽度、脚模居中，默认再放大一档
const MODEL_SCALE_DEFAULT = 3.5;
const MODEL_SCALE_STEP = 0.18;
const MODEL_SCALE_MIN = 2.0;
const MODEL_SCALE_MAX = 4.8;

const HOME_ASSETS = {
  deviceConnected: "/assets/icons/home-page/device-connected.svg",
  deviceDisconnected: "/assets/icons/home-page/device-disconnected.svg",
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
          background: `linear-gradient(to right, #00359f 0 ${pct}%, #d6deef ${pct}% 100%)`,
        }}
      />
      <div className="measure-param-scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/** 悬浮 HUD 里的一组读数：标题 / 实时大数字 / 平均 · 峰值 */
function HudGroup({
  heading,
  english,
  unit,
  values,
  extra,
}: {
  heading: string;
  english: string;
  unit: string;
  values: { realtime: number; average: number; peak: number; total: number };
  /** 附加一项（如压力卡下方的「总力 N」），与平均/峰值并排 */
  extra?: { label: string; value: number; unit: string };
}) {
  return (
    <section className="hud-group">
      <header className="hud-head">
        <span className="hud-title">{heading}</span>
        <span className="hud-en">{english}</span>
      </header>
      <div className="hud-main">
        <div className="hud-main-value">
          <strong>{values.realtime}</strong>
          <small>{unit}</small>
        </div>
      </div>
      <div className="hud-sub">
        <div className="hud-sub-item">
          <span>平均</span>
          <b>
            {values.average}
            <i>{unit}</i>
          </b>
        </div>
        <div className="hud-sub-item">
          <span>峰值</span>
          <b>
            {values.peak}
            <i>{unit}</i>
          </b>
        </div>
        {extra && (
          <div className="hud-sub-item">
            <span>{extra.label}</span>
            <b>
              {extra.value}
              <i>{extra.unit}</i>
            </b>
          </div>
        )}
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
  const titles: Record<typeof type, string> = {
    mode: "切换 2D / 3D",
    plus: "放大",
    minus: "缩小",
    focus: "复位视图",
    sliders: "调整参数",
  };
  // 内联线条图标（无底色）：工具条直接浮在舞台上，不带白底板
  const icon = (() => {
    const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
    switch (type) {
      case "mode":
        return (
          <svg viewBox="0 0 24 24" {...s}>
            <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
            <path d="M4 7.5 12 12l8-4.5M12 12v9" />
          </svg>
        );
      case "plus":
        return (
          <svg viewBox="0 0 24 24" {...s}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        );
      case "minus":
        return (
          <svg viewBox="0 0 24 24" {...s}>
            <path d="M5 12h14" />
          </svg>
        );
      case "focus":
        return (
          <svg viewBox="0 0 24 24" {...s}>
            <path d="M4 12a8 8 0 1 0 2.5-5.8" />
            <path d="M4 4v5h5" />
          </svg>
        );
      case "sliders":
        return (
          <svg viewBox="0 0 24 24" {...s}>
            <path d="M6 4v16M12 4v16M18 4v16" />
            <circle cx="6" cy="9" r="2.2" fill="#fff" />
            <circle cx="12" cy="15" r="2.2" fill="#fff" />
            <circle cx="18" cy="8" r="2.2" fill="#fff" />
          </svg>
        );
    }
  })();

  return (
    <button
      className={active ? "measure-control active" : "measure-control"}
      type="button"
      onClick={onClick}
      title={titles[type]}
      aria-label={titles[type]}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}

/** 采集按钮：一枚按钮 + 倒数秒数（进度效果由舞台上的扫描线承担，这里不画圆弧） */
function CountdownButton({
  state,
  seconds,
  labelRef,
  countRef,
  onClick,
}: {
  state: CollectState;
  seconds: number;
  labelRef: RefObject<HTMLSpanElement | null>;
  countRef: RefObject<HTMLSpanElement | null>;
  onClick?: () => void;
}) {
  const displaySeconds = state === "idle" ? TOTAL_DURATION_SECONDS : state === "done" ? 0 : seconds;
  const label = state === "done" ? "测量完成" : state === "collecting" ? "停止测量" : "开始测量";

  return (
    <button className={`measure-countdown-button ${state}`} type="button" onClick={onClick} aria-label={label}>
      <span className="countdown-core">
        <i />
      </span>
      <strong ref={labelRef}>{label}</strong>
      <span className="dock-count">
        <span ref={countRef}>{String(displaySeconds).padStart(2, "0")}</span>
        <small>s</small>
      </span>
    </button>
  );
}

export default function MeasurePage({
  onNext,
  onEnd,
  onHistory,
}: {
  onNext: () => void;
  /** 结束体验：清当前用户并直接回首页（不是流程下一步） */
  onEnd: () => void;
  /** 右上角常驻「体验记录」入口 */
  onHistory?: () => void;
  /** 测量页已去掉步骤导航条，保留该 prop 仅为兼容调用方 */
  onStepBack?: (step: number) => void;
}) {
  const { setAnalysis } = useApp();
  const [collectState, setCollectState] = useState<CollectState>("idle");
  // 本次采集/回放总时长：实采固定 30s；导入回放 = 帧数 × REPLAY_FRAME_MS（跟数据走）
  const [durationMs, setDurationMs] = useState(TOTAL_DURATION_MS);
  const durationMsRef = useRef(TOTAL_DURATION_MS);
  const setDuration = (ms: number) => {
    durationMsRef.current = ms;
    setDurationMs(ms);
  };
  // 导入回放：当前回放的文件名（null = 实采）；回放期间忽略足垫实时帧
  const [replayFile, setReplayFile] = useState<string | null>(null);
  const replayingRef = useRef(false);
  const replayTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const countRef = useRef<HTMLSpanElement | null>(null);
  // 舞台扫描线：采集期间从脚模底部扫到顶部（30s 一遍），进度直接改 style 不走 setState
  const scanRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedBeforeStartRef = useRef(0);
  const elapsedRef = useRef(0);
  const lastStateSyncRef = useRef(0);

  // ===== 设备连接 + 实时指标（受压面积/压力联动） =====
  // 连接归全局 deviceManager（进入系统即自动按设备码连接）；本页只订阅帧与状态
  const [deviceConnected, setDeviceConnected] = useState(() => deviceManager.isConnected());
  const [connecting, setConnecting] = useState(false);
  const [areaData, setAreaData] = useState(EMPTY_METRICS);
  // 压力卡：平均压强 kPa（主值 / 平均 / 峰值）+ 总力 N（附加项）。二者都由标定公式 adcToKpa 逐格换算而来
  const [pressureData, setPressureData] = useState(EMPTY_METRICS);
  const [forceN, setForceN] = useState(0);
  const noiseFilterRef = useRef(noiseFilter);
  const metricAccRef = useRef({ frames: 0, areaSum: 0, areaPeak: 0, pressSum: 0, pressPeak: 0 });
  const lastMetricUiRef = useRef(0);
  const lastFrameUiRef = useRef(0);
  const collectingRef = useRef(false);
  // 采集/回放期间记录全部帧（4096 平铺），完成后送分析
  const framesRef = useRef<number[][]>([]);
  const [latestFrame, setLatestFrame] = useState<number[][] | null>(null);

  // 噪声阈值变化时同步到串口服务（也供帧回调读取）
  useEffect(() => {
    noiseFilterRef.current = noiseFilter;
    deviceManager.setFilterThreshold(noiseFilter);
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

    // 本帧面积/压力。压力不再是 ADC 总和：每个有效格先按标定曲线换成 kPa（lib/pressureCalib），
    // 再 Σ kPa×面积 得总力 N、总力/接触面积 得平均压强 kPa —— 与接触面积、脚型无关
    const threshold = noiseFilterRef.current;
    let active = 0;
    let kpaSum = 0;
    for (let r = 0; r < frame.length; r++) {
      const row = frame[r];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v > threshold) {
          active += 1;
          kpaSum += adcToKpa(v);
        }
      }
    }
    const area = active * CELL_AREA_CM2; // cm²
    const force = kpaSum * 1000 * CELL_AREA_M2; // N
    const pressure = active ? kpaSum / active : 0; // 平均压强 kPa

    // 采集期间逐帧记录（供完成后送分析），上限 900 帧防内存膨胀；
    // 回放不在这里记录——它自己持有全量帧，播完直接写 framesRef
    if (collectingRef.current && !replayingRef.current && framesRef.current.length < 900) {
      framesRef.current.push(frame.flat());
    }

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
      realtime: r1(pressure),
      average: r1(acc.pressSum / n),
      peak: r1(acc.pressPeak),
      total: r1(acc.pressSum),
    });
    setForceN(r1(force));
  };

  const resetMetrics = () => {
    metricAccRef.current = { frames: 0, areaSum: 0, areaPeak: 0, pressSum: 0, pressPeak: 0 };
    lastMetricUiRef.current = 0;
    framesRef.current = [];
    setAreaData(EMPTY_METRICS);
    setPressureData(EMPTY_METRICS);
    setForceN(0);
  };

  // 订阅全局设备帧（串口桥 WebSocket 或 Web Serial，deviceManager 统一分发）+ 连接状态。
  // 连接由 deviceManager 全局维护（掉线弹窗也在那处理），离开测量页只解除本页订阅，
  // 不断开设备——回到页面即恢复实时画面。
  // （handleFrameRef 在下方"订阅后台 job"处声明，两条管线共用）
  useEffect(() => {
    deviceManager.setFilterThreshold(noiseFilterRef.current);
    // 回放导入数据期间忽略足垫实时帧，避免两路数据混进同一条指标管线
    deviceManager.setOnData((frame) => {
      if (!replayingRef.current) handleFrameRef.current(frame);
    });
    setDeviceConnected(deviceManager.isConnected());
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ connected?: boolean }>).detail;
      if (typeof detail?.connected === "boolean") setDeviceConnected(detail.connected);
    };
    window.addEventListener("aciki-device-status", onStatus);
    return () => {
      deviceManager.setOnData(null);
      window.removeEventListener("aciki-device-status", onStatus);
    };
  }, []);

  // 手动选 COM 口兜底弹窗（串口桥在跑、但自动扫描没匹配到已登记足垫时打开）
  const [showPortPicker, setShowPortPicker] = useState(false);

  const connectDevice = async () => {
    if (connecting) return;
    if (deviceConnected) {
      await deviceManager.disconnect();
      return;
    }
    setConnecting(true);
    try {
      // 桥模式：桥自动扫描；兜底模式：先自动匹配已授权的足垫（校验设备码），没有再弹浏览器授权框
      await deviceManager.connectWithPrompt();
    } catch (err) {
      if (deviceManager.bridgeAvailable) {
        // 桥在跑却没找到已登记足垫：换了垫子 / 固件不回身份 / 口被占——让用户直接指定 COM 口
        setShowPortPicker(true);
      } else {
        // 浏览器直连路径失败：按错误类型弹出对应异常弹窗
        broadcastException(classifySerialError(err));
      }
    } finally {
      setConnecting(false);
    }
  };

  // 采集完成 → 启动后台分析（不随组件卸载而取消），结果经 "aciki-analysis-done" 事件回流
  useEffect(() => {
    if (collectState !== "done") return;
    setGenerating(true);
    void runBgAnalysis(framesRef.current.slice()); // 回放路径已在分析时内部防重
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

  const remaining = Math.max(0, Math.ceil((durationMs - elapsedMs) / 1000));

  const syncCountdownVisual = (elapsed: number, state: CollectState) => {
    const p = state === "done" ? 1 : Math.min(Math.max(elapsed / durationMsRef.current, 0), 1);
    if (scanRef.current) {
      scanRef.current.style.setProperty("--scan-p", p.toFixed(4));
      scanRef.current.dataset.state = state;
    }

    const seconds =
      state === "idle"
        ? TOTAL_DURATION_SECONDS
        : Math.max(0, Math.ceil((durationMsRef.current - elapsed) / 1000));
    if (labelRef.current) {
      labelRef.current.textContent = state === "done" ? "测量完成" : state === "collecting" ? "停止测量" : "开始测量";
    }
    if (countRef.current) {
      countRef.current.textContent = String(seconds).padStart(2, "0");
    }
  };

  // 倒计时用 setInterval + 时间戳（而非 rAF）：后台标签页 rAF 会完全冻结，
  // interval 虽被节流到 ~1s/次但仍推进，elapsed 按真实时间差计算，到点照常完成
  const stopRaf = () => {
    if (rafRef.current !== null) {
      window.clearInterval(rafRef.current);
      rafRef.current = null;
    }
  };

  const runCollectingFrame = (now: number) => {
    if (startedAtRef.current === null) startedAtRef.current = now;
    const total = durationMsRef.current;
    const elapsed = Math.min(elapsedBeforeStartRef.current + now - startedAtRef.current, total);

    elapsedRef.current = elapsed;
    syncCountdownVisual(elapsed, elapsed >= total ? "done" : "collecting");

    if (now - lastStateSyncRef.current > 120 || elapsed >= total) {
      lastStateSyncRef.current = now;
      setElapsedMs(elapsed);
    }

    if (elapsed >= total) {
      stopRaf();
      setCollectState("done");
      setElapsedMs(total);
    }
  };

  const startCollectTimer = () => {
    stopRaf();
    rafRef.current = window.setInterval(() => runCollectingFrame(performance.now()), 120);
  };

  useEffect(() => {
    syncCountdownVisual(elapsedMs, collectState);
  }, [collectState, elapsedMs]);

  useEffect(() => {
    return () => stopRaf();
  }, []);

  // 空闲 → 开始一次正式采集（实采需要设备在线）
  const beginCollect = () => {
    // 设备未连接就开始只会空转倒数：拦下并提示
    if (!deviceManager.isConnected()) {
      broadcastException("disconnected");
      return;
    }
    stopReplay();
    setReplayFile(null);
    setDuration(TOTAL_DURATION_MS); // 实采固定 30s（回放可能改过时长，这里恢复）
    elapsedBeforeStartRef.current = 0;
    elapsedRef.current = 0;
    setElapsedMs(0);
    resetMetrics();
    startedAtRef.current = null;
    setCollectState("collecting");
    startCollectTimer();
  };

  // 体验模式不登记人名：点"开始测量"直接采集（记录入库时挂到匿名「体验」用户）
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

    beginCollect();
  };

  const resetCollecting = () => {
    stopRaf();
    stopReplay();
    setReplayFile(null);
    startedAtRef.current = null;
    elapsedBeforeStartRef.current = 0;
    elapsedRef.current = 0;
    setElapsedMs(0);
    setDuration(TOTAL_DURATION_MS); // 回到空闲：恢复默认 30s 显示
    setCollectState("idle");
    resetMetrics();
  };

  // 订阅后台分析 job：相位变化 → 同步"生成报告"状态；挂载时恢复进行中的分析
  const handleFrameRef = useRef<(m: number[][]) => void>(() => {});
  handleFrameRef.current = handleFrame;
  useEffect(() => {
    // 挂载恢复：切回来时接上还在跑的分析
    if (bgJob.phase === "analyzing") {
      setCollectState("done");
      setGenerating(true);
    }
    return subscribeBgJob({
      onPhase: (phase) => {
        if (phase === "analyzing") setCollectState("done");
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 导入数据回放（csv/json）：逐帧送入同一条指标/热力管线，扫描线随进度走，播完自动分析 =====
  const startReplay = (frames: number[][], fileName: string) => {
    stopRaf();
    stopReplay();
    resetMetrics();
    const n = frames.length;
    const total = n * REPLAY_FRAME_MS;
    setDuration(total);
    elapsedBeforeStartRef.current = 0;
    elapsedRef.current = 0;
    setElapsedMs(0);
    setReplayFile(fileName);
    setCollectState("collecting");
    replayingRef.current = true;

    const startAt = performance.now();
    let last = -1;
    // 时间戳追帧：后台标签页 interval 被节流时按真实耗时跳到应播帧，总时长不变
    replayTimerRef.current = window.setInterval(() => {
      const now = performance.now();
      const idx = Math.min(n - 1, Math.floor((now - startAt) / REPLAY_FRAME_MS));
      if (idx > last) {
        last = idx;
        handleFrameRef.current(reshapeFrame(frames[idx]));
        const elapsed = Math.min((idx + 1) * REPLAY_FRAME_MS, total);
        elapsedRef.current = elapsed;
        syncCountdownVisual(elapsed, "collecting");
        if (now - lastStateSyncRef.current > 120) {
          lastStateSyncRef.current = now;
          setElapsedMs(elapsed);
        }
      }
      if (idx >= n - 1) {
        stopReplay();
        framesRef.current = frames; // 全量送分析（不受 handleFrame 的 900 帧上限影响）
        setElapsedMs(total);
        setCollectState("done");
      }
    }, REPLAY_FRAME_MS);
  };

  // ===== 导入数据回放（csv/json）：逐帧送入同一条指标/热力管线，扫描线随进度走，播完自动分析 =====
  const stopReplay = () => {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replayingRef.current = false;
  };

  const handleImportFile = async (file: File) => {
    try {
      let frames = await parseCollectionFile(file);
      if (frames.length === 0) {
        window.alert("未在文件中找到有效的压力帧数据（需含 data 列，每帧 4096 个值）");
        return;
      }
      if (frames.length > MAX_REPLAY_FRAMES) frames = frames.slice(0, MAX_REPLAY_FRAMES);
      startReplay(frames, file.name);
    } catch (err) {
      window.alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => () => stopReplay(), []);

  // 分析完成（可能发生在本页或后台）：入库并跳报告页
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<MeasureAnalysis>).detail;
      if (!detail) return;
      setAnalysis(detail);
      setGenerating(false);
      onNextRef.current();
    };
    window.addEventListener("aciki-analysis-done", h);
    return () => window.removeEventListener("aciki-analysis-done", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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
      {showPortPicker && (
        <PortPickerModal
          onClose={() => setShowPortPicker(false)}
          onConnected={() => toast.success("足垫已连接", { description: "可以开始测量了" })}
        />
      )}
      {/* 顶栏：左 Logo；右 设备状态/连接/导入 + 常驻「体验记录」入口。不放标题与步骤导航条 */}
      <header className="measure-topbar">
        <div className="measure-topbar-left">
          <BrandLogo size={44} />
        </div>
        <div className="measure-topbar-right">
          <DeviceStatusBadge connected={deviceConnected} />
          <button
            className="measure-connect-btn"
            type="button"
            onClick={connectDevice}
            disabled={connecting}
          >
            {connecting ? "连接中…" : deviceConnected ? "断开设备" : "连接设备"}
          </button>
          {/* 导入设备软件导出的 sit*.csv（或本系统落盘的原始帧 CSV）回放并分析，不需要连足垫 */}
          <button
            className="measure-connect-btn measure-import-btn"
            type="button"
            onClick={() => {
              if (collectState === "collecting") {
                resetCollecting();
                return;
              }
              fileInputRef.current?.click();
            }}
          >
            {collectState === "collecting" && replayFile ? "停止回放" : "导入数据"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = ""; // 允许重复选择同一文件
            }}
          />
          <HistoryLink onClick={onHistory} />
        </div>
      </header>

      {/* 舞台：铺满顶栏与底部控制坞之间；脚模居中放大，读数 HUD / 工具条 / 色阶全部悬浮其上 */}
      <section className="measure-stage">
        <div className="measure-model" style={{ pointerEvents: viewMode === "2d" ? "auto" : "none" }}>
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
          {/* 采集扫描线：从下往上扫过脚模，带向下拖影；位置由 --scan-p 驱动 */}
          <div ref={scanRef} className="measure-scan" data-state={collectState} aria-hidden="true">
            <span className="measure-scan-trail" />
            <span className="measure-scan-line" />
          </div>
        </div>

        {/* 左：玻璃质感读数 HUD */}
        <aside className="measure-hud">
          <HudGroup heading="受压面积" english="Contact Area" unit="cm²" values={areaData} />
          <div className="hud-divider" />
          <HudGroup heading="压强" english="Pressure" unit="kPa" values={pressureData} extra={{ label: "总力", value: forceN, unit: "N" }} />
        </aside>

        {/* 右：竖排工具条 */}
        <div className="measure-controls">
          <ControlButton
            type="mode"
            active={viewMode === "2d"}
            onClick={() => setViewMode((v) => (v === "3d" ? "2d" : "3d"))}
          />
          <ControlButton type="plus" onClick={() => zoomModel(1)} />
          <ControlButton type="minus" onClick={() => zoomModel(-1)} />
          <ControlButton type="focus" onClick={resetModelView} />
          <ControlButton type="sliders" active={showParams} onClick={() => setShowParams((v) => !v)} />
        </div>

        {showParams && (
          <div className="measure-control-panel">
            <ParamSlider label="过滤ADC噪声" hint="信号平滑程度" min={0} max={50} value={noiseFilter} onChange={setNoiseFilter} />
            <div className="measure-param-divider" />
            <ParamSlider label="颜色显示" hint="颜色饱和程度" min={0} max={255} value={colorLevel} onChange={setColorLevel} />
          </div>
        )}
      </section>

      {/* 底部控制坞：深蓝胶囊，采集按钮 + 采集状态 + 当前用户 + 操作 */}
      <footer className="measure-dock">
        <CountdownButton
          state={collectState}
          seconds={remaining}
          labelRef={labelRef}
          countRef={countRef}
          onClick={handleCollectClick}
        />
        <div className="dock-status">
          <span className="dock-status-label">
            {collectState === "collecting" ? "采集中" : collectState === "done" ? "已完成" : "就绪"}
          </span>
          <span className="dock-status-sub">
            {collectState === "collecting"
              ? replayFile
                ? `回放 ${Math.round(durationMs / 1000)}s 导入数据`
                : "请保持自然站立"
              : collectState === "done"
              ? "正在生成分析报告"
              : `单次采集 ${TOTAL_DURATION_SECONDS}s`}
          </span>
        </div>
        <div className="dock-divider" />
        <span className="dock-user" title={replayFile ?? undefined}>
          {replayFile ? `导入：${replayFile}` : "实时采集"}
        </span>
        <div className="dock-actions">
          <button type="button" onClick={resetCollecting}>
            重新测量
          </button>
          <button type="button" className="dock-end" onClick={onEnd}>
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
    --measure-topbar-h: clamp(72px, 9vh, 96px);
    --measure-dock-h: clamp(104px, 13vh, 132px);
    --measure-control-size: clamp(38px, 2.4vw, 46px);
    --brand: #00359b;
    position: relative;
    width: 100vw;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    /* 顶部淡蓝 → 向下渐白的干净背景（透视网格已取消） */
    background: linear-gradient(180deg, #EEF4FF 0%, #FFFFFF 57.5%, #FFFFFF 100%);
    isolation: isolate;
    /* 数字用本地 Inter（index.html 已内置），中文回落到系统黑体 */
    font-family: "Inter", "HarmonyOS Sans SC", "MiSans", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    color: #1f1f1f;
  }

  html:has(.measure-shell),
  body:has(.measure-shell),
  #root:has(.measure-shell) {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  /* ── 顶栏：左 Logo+标题，右 设备状态+连接 ── */
  .measure-topbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 12;
    height: var(--measure-topbar-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--measure-pad-x);
    box-sizing: border-box;
  }

  .measure-topbar-left {
    display: flex;
    align-items: center;
    gap: clamp(18px, 1.8vw, 32px);
  }

  .measure-topbar-right {
    display: flex;
    align-items: center;
    gap: clamp(12px, 1.15vw, 22px);
  }

  .measure-device-status {
    width: clamp(96px, 6.6vw, 128px);
    height: auto;
    display: block;
  }

  .measure-connect-btn {
    border: 1px solid var(--brand);
    background: #ffffff;
    color: var(--brand);
    border-radius: 999px;
    padding: clamp(7px, 0.7vh, 10px) clamp(14px, 1.1vw, 20px);
    font-size: clamp(12px, 0.83vw, 15px);
    font-weight: 700;
    white-space: nowrap;
    transition: background 160ms ease, transform 160ms ease;
  }

  .measure-connect-btn:hover { background: #eaf1ff; }
  .measure-import-btn {
    background: var(--brand);
    color: #ffffff;
  }
  .measure-import-btn:hover { background: #0a44b8; }
  .measure-connect-btn:active { transform: scale(0.97); }
  .measure-connect-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* ── 舞台：铺满顶栏与控制坞之间 ── */
  .measure-stage {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--measure-topbar-h);
    bottom: var(--measure-dock-h);
    z-index: 1;
  }

  .measure-model {
    position: absolute;
    /* 左右对称 → 脚模中心 = 视口中心，与底部控制坞对齐；HUD / 工具条浮在两侧留白上 */
    left: calc(var(--measure-pad-x) + clamp(150px, 11vw, 200px));
    right: calc(var(--measure-pad-x) + clamp(150px, 11vw, 200px));
    top: 0;
    bottom: 0;
    pointer-events: none;
  }

  /* ── 采集扫描线：脚模区域内从下往上扫，向下拖影 ── */
  .measure-scan {
    --scan-p: 0;
    position: absolute;
    /* 线宽贴着脚模宽度走（比脚模略宽一点），不横扫整屏 */
    left: 18%;
    right: 18%;
    /* 扫描行程要盖过整只脚：脚模在舞台里从底部约 5%（脚跟）伸到约 93%（脚趾尖），
       原来的 10%→90% 在大拇指中段就停了；改成 4%→97%，收尾时线已越过趾尖 */
    bottom: calc(4% + var(--scan-p) * 93%);
    height: 0;
    opacity: 0;
    pointer-events: none;
    z-index: 3;
    transition: bottom 120ms linear, opacity 240ms ease;
  }

  .measure-scan[data-state="collecting"] { opacity: 1; }
  .measure-scan[data-state="done"] { opacity: 0; transition-delay: 0ms, 400ms; }

  .measure-scan-line {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(0,53,155,0) 0%, #2f6bff 12%, #9fc3ff 50%, #2f6bff 88%, rgba(0,53,155,0) 100%);
    box-shadow:
      0 0 6px rgba(63, 120, 255, 0.9),
      0 0 18px rgba(63, 120, 255, 0.55),
      0 0 40px rgba(63, 120, 255, 0.3);
  }

  .measure-scan-trail {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: clamp(70px, 11vh, 120px);
    background: linear-gradient(180deg, rgba(63, 120, 255, 0.34) 0%, rgba(63, 120, 255, 0.12) 45%, rgba(63, 120, 255, 0) 100%);
    mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent);
  }

  /* ── 左：无框读数（直接浮在舞台上） ── */
  .measure-hud {
    position: absolute;
    left: var(--measure-pad-x);
    top: 50%;
    transform: translateY(-50%);
    width: clamp(230px, 17vw, 300px);
    display: grid;
    gap: clamp(22px, 3.4vh, 40px);
    z-index: 4;
  }

  .hud-group {
    display: grid;
    gap: clamp(8px, 1.2vh, 14px);
    padding-left: clamp(12px, 1vw, 18px);
    border-left: 3px solid var(--brand);
  }

  .hud-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hud-title {
    font-size: clamp(13px, 0.9vw, 16px);
    font-weight: 600;
    letter-spacing: 0.22em;
    color: #2a3550;
  }

  .hud-en {
    font-size: clamp(9px, 0.62vw, 11px);
    font-weight: 500;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #8d98b3;
  }

  .hud-main {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .hud-main-value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .hud-main-value strong {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-size: clamp(44px, 3.6vw, 66px);
    font-weight: 700;
    line-height: 0.95;
    color: var(--brand);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.04em;
  }

  .hud-main-value small {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-size: clamp(12px, 0.85vw, 15px);
    font-weight: 500;
    color: #8d98b3;
  }

  .hud-sub {
    display: flex;
    gap: clamp(18px, 1.6vw, 30px);
  }

  .hud-sub-item {
    display: grid;
    gap: 3px;
  }

  .hud-sub-item span {
    font-size: clamp(10px, 0.68vw, 12px);
    font-weight: 500;
    letter-spacing: 0.18em;
    color: #8d98b3;
  }

  .hud-sub-item b {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-size: clamp(17px, 1.2vw, 22px);
    font-weight: 600;
    color: #1f2a44;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .hud-sub-item i {
    margin-left: 3px;
    font-style: normal;
    font-size: clamp(9px, 0.62vw, 11px);
    font-weight: 500;
    color: #8d98b3;
  }

  .hud-divider { display: none; }

  /* ── 右：竖排工具条（贴右边缘） ── */
  .measure-controls {
    position: absolute;
    right: var(--measure-pad-x);
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    gap: clamp(10px, 1.4vh, 16px);
    z-index: 5;
  }

  /* 无底工具按钮：细描边圆形 + 线条图标，悬停/激活时填充品牌蓝 */
  .measure-control {
    width: var(--measure-control-size);
    height: var(--measure-control-size);
    border: 1.5px solid rgba(0, 53, 155, 0.35);
    border-radius: 999px;
    background: transparent;
    color: var(--brand);
    padding: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease;
  }

  .measure-control svg {
    width: 52%;
    height: 52%;
    display: block;
  }

  .measure-control:hover {
    border-color: var(--brand);
    transform: translateY(-1px);
  }
  .measure-control:active { transform: scale(0.94); }

  .measure-control.active {
    background: var(--brand);
    border-color: var(--brand);
    color: #ffffff;
  }
  .measure-control.active svg circle { fill: var(--brand); }

  /* 参数浮层：贴在工具条左侧 */
  .measure-control-panel {
    position: absolute;
    right: calc(var(--measure-pad-x) + var(--measure-control-size) + clamp(20px, 1.6vw, 28px));
    top: 50%;
    transform: translateY(-50%);
    width: clamp(232px, 17vw, 299px);
    box-sizing: border-box;
    padding: clamp(14px, 1.8vh, 18px) clamp(16px, 1.3vw, 22px);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 20px 50px rgba(0, 53, 155, 0.16);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: grid;
    gap: clamp(10px, 1.4vh, 14px);
    z-index: 6;
  }

  .measure-param { display: grid; gap: clamp(5px, 0.7vh, 8px); }

  .measure-param-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .measure-param-title {
    font-size: clamp(13px, 0.9vw, 16px);
    font-weight: 800;
    color: #17191c;
    white-space: nowrap;
  }

  .measure-param-hint {
    font-size: clamp(10px, 0.66vw, 12px);
    font-weight: 500;
    color: #7c89a6;
    white-space: nowrap;
  }

  .measure-param-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: clamp(10px, 0.8vw, 14px);
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
    box-shadow: 0 1px 4px rgba(19,49,109,0.35);
    cursor: pointer;
  }

  .measure-param-slider::-moz-range-thumb {
    width: clamp(16px, 1.2vw, 20px);
    height: clamp(16px, 1.2vw, 20px);
    border: none;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(19,49,109,0.35);
    cursor: pointer;
  }

  .measure-param-scale {
    display: flex;
    justify-content: space-between;
    font-size: clamp(11px, 0.72vw, 13px);
    font-weight: 600;
    color: #565d6b;
  }

  .measure-param-divider {
    height: 1px;
    background: rgba(0, 53, 155, 0.14);
  }

  /* ── 底部控制坞：深蓝胶囊 ── */
  .measure-dock {
    position: fixed;
    left: 50%;
    bottom: clamp(18px, 2.8vh, 30px);
    transform: translateX(-50%);
    z-index: 12;
    display: flex;
    align-items: center;
    gap: clamp(12px, 1.2vw, 20px);
    max-width: calc(100vw - var(--measure-pad-x) * 2);
    box-sizing: border-box;
    padding: 7px clamp(12px, 1vw, 18px) 7px 7px;
    border-radius: 999px;
    background: linear-gradient(120deg, #0d47c0 0%, #00359b 55%, #062c80 100%);
    color: #ffffff;
    box-shadow:
      0 22px 54px rgba(0, 53, 155, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  /* 采集按钮：白色胶囊 = 图标 + 文案 + 倒数秒数（无圆弧） */
  .measure-countdown-button {
    display: flex;
    align-items: center;
    gap: clamp(10px, 0.9vw, 14px);
    padding: 6px clamp(10px, 0.9vw, 14px) 6px 6px;
    border: 0;
    border-radius: 999px;
    background: #ffffff;
    color: var(--brand);
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .measure-countdown-button:hover { box-shadow: 0 8px 24px rgba(0, 0, 0, 0.26); }
  .measure-countdown-button:active { transform: scale(0.97); }

  .countdown-core {
    width: clamp(36px, 2.6vw, 44px);
    height: clamp(36px, 2.6vw, 44px);
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--brand);
    flex: 0 0 auto;
    transition: background 180ms ease;
  }

  /* 待测量：播放三角；采集中：停止方块；完成：对勾感的圆点 */
  .countdown-core i {
    display: block;
    width: 34%;
    height: 34%;
    margin-left: 10%;
    background: #ffffff;
    clip-path: polygon(0 0, 100% 50%, 0 100%);
  }

  .measure-countdown-button.collecting .countdown-core { background: #e5484d; }
  .measure-countdown-button.collecting .countdown-core i {
    margin-left: 0;
    width: 32%;
    height: 32%;
    border-radius: 2px;
    clip-path: none;
  }

  .measure-countdown-button.done .countdown-core { background: #1aa36b; }
  .measure-countdown-button.done .countdown-core i {
    margin-left: 0;
    width: 30%;
    height: 30%;
    border-radius: 999px;
    clip-path: none;
  }

  .measure-countdown-button strong {
    font-size: clamp(14px, 0.95vw, 17px);
    font-weight: 700;
    letter-spacing: 0.08em;
    white-space: nowrap;
    line-height: 1.2;
  }

  .dock-count {
    display: flex;
    align-items: baseline;
    gap: 2px;
    padding-left: clamp(10px, 0.9vw, 14px);
    border-left: 1px solid rgba(0, 53, 155, 0.18);
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .dock-count > span {
    font-size: clamp(22px, 1.7vw, 30px);
    font-weight: 700;
    letter-spacing: -0.04em;
  }

  .dock-count small {
    font-size: clamp(11px, 0.8vw, 14px);
    font-weight: 500;
    color: #8d98b3;
  }

  .dock-status {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .dock-status-label {
    font-size: clamp(13px, 0.9vw, 15px);
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;
  }

  .dock-status-sub {
    font-size: clamp(10px, 0.7vw, 12px);
    font-weight: 500;
    color: rgba(255, 255, 255, 0.72);
    white-space: nowrap;
  }

  .dock-divider {
    width: 1px;
    height: clamp(28px, 3.4vh, 38px);
    background: rgba(255, 255, 255, 0.22);
    flex: 0 0 auto;
  }

  .dock-user {
    font-size: clamp(12px, 0.83vw, 14px);
    font-weight: 600;
    color: rgba(255, 255, 255, 0.86);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: clamp(160px, 16vw, 280px);
  }

  .dock-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dock-actions button {
    border: 1px solid rgba(255, 255, 255, 0.4);
    background: transparent;
    color: #ffffff;
    border-radius: 999px;
    padding: clamp(7px, 0.7vh, 9px) clamp(12px, 1vw, 16px);
    font-size: clamp(12px, 0.8vw, 14px);
    font-weight: 700;
    white-space: nowrap;
    cursor: pointer;
    transition: background 140ms ease, transform 140ms ease;
  }

  .dock-actions button:hover { background: rgba(255, 255, 255, 0.14); }
  .dock-actions button:active { transform: scale(0.96); }

  .dock-actions .dock-end {
    background: #ffffff;
    border-color: #ffffff;
    color: var(--brand);
  }

  .dock-actions .dock-end:hover { background: #eaf1ff; }

  /* ── 生成报告遮罩 ── */
  .measure-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(35,53,90,0.32);
    backdrop-filter: blur(2px);
    animation: measure-loading-fade 180ms ease-out;
  }

  .measure-loading-card {
    display: grid;
    justify-items: center;
    gap: clamp(16px, 2.4vh, 26px);
    width: min(420px, calc(100vw - 64px));
    padding: clamp(30px, 4.5vh, 44px) clamp(28px, 2.6vw, 40px);
    border-radius: 18px;
    background: #ffffff;
    border: 1px solid rgba(0, 53, 155, 0.2);
    box-shadow: 0 24px 70px rgba(27,53,107,0.3);
    animation: measure-loading-pop 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .measure-loading-spinner {
    width: clamp(56px, 5vw, 76px);
    height: auto;
    animation: measure-loading-spin 1.1s linear infinite;
  }

  .measure-loading-card p {
    margin: 0;
    color: #1c263a;
    font-size: clamp(15px, 1vw, 18px);
    font-weight: 700;
  }

  @keyframes measure-loading-spin { to { transform: rotate(360deg); } }
  @keyframes measure-loading-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes measure-loading-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ── 响应式 ── */
  @media (max-width: 1400px) {
    .measure-shell {
      --measure-pad-x: clamp(22px, 3vw, 40px);
    }
  }

  @media (max-width: 1120px) {
    .measure-shell {
      --measure-pad-x: clamp(16px, 2.2vw, 24px);
      --measure-topbar-h: clamp(64px, 8vh, 80px);
      --measure-dock-h: clamp(96px, 12vh, 116px);
      --measure-control-size: clamp(34px, 3.2vw, 38px);
    }

    .measure-hud { width: clamp(200px, 24vw, 240px); }
    .measure-model {
      left: calc(var(--measure-pad-x) + clamp(200px, 24vw, 240px));
      right: calc(var(--measure-pad-x) + clamp(60px, 7vw, 80px));
    }
    .dock-user { display: none; }
  }
`;
