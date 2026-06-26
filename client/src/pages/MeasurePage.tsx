import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useApp } from "@/contexts/AppContext";
import FeetModel3D from "@/components/FeetModel3D";
import TopNavBar from "@/components/TopNavBar";

type CollectState = "idle" | "collecting" | "paused" | "done";

const TOTAL_DURATION_MS = 30000;
const TOTAL_DURATION_SECONDS = 30;
const COUNTDOWN_RADIUS = 34;
const COUNTDOWN_CIRCUMFERENCE = 2 * Math.PI * COUNTDOWN_RADIUS;
const COUNTDOWN_ARC_LENGTH = COUNTDOWN_CIRCUMFERENCE * 0.75;
const COUNTDOWN_DASH_OFFSET = 0;
const MODEL_SCALE_DEFAULT = 2.06;
const MODEL_SCALE_STEP = 0.12;
const MODEL_SCALE_MIN = 1.7;
const MODEL_SCALE_MAX = 2.58;

const HOME_ASSETS = {
  deviceConnected: "/assets/icons/home-page/device-connected.svg",
  deviceDisconnected: "/assets/icons/home-page/device-disconnected.svg",
};

const MEASURE_ASSETS = {
  stepOne: "/assets/icons/realtime-pressure-page/group-1705.svg",
  stepTwo: "/assets/icons/realtime-pressure-page/group-1706.svg",
  stepThree: "/assets/icons/realtime-pressure-page/group-1707.svg",
  stepFour: "/assets/icons/realtime-pressure-page/group-1708.svg",
  mode3d: "/assets/icons/realtime-pressure-page/view-2d-3d.svg",
  plus: "/assets/icons/realtime-pressure-page/zoom-in.svg",
  reset: "/assets/icons/realtime-pressure-page/group-1724.svg",
  settings: "/assets/icons/realtime-pressure-page/adjust-params.svg",
  zoomOut: "/assets/icons/realtime-pressure-page/zoom-out.svg",
};

const MODE_STEPS = [
  { label: "创建", icon: MEASURE_ASSETS.stepOne },
  { label: "测量", icon: MEASURE_ASSETS.stepTwo },
  { label: "报告", icon: MEASURE_ASSETS.stepThree },
  { label: "方案", icon: MEASURE_ASSETS.stepFour },
];

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

function DeviceStatusBadge() {
  const connected = useDeviceConnectionStatus();

  return (
    <img
      className="measure-device-status"
      src={connected ? HOME_ASSETS.deviceConnected : HOME_ASSETS.deviceDisconnected}
      alt={connected ? "设备连接正常" : "设备连接异常"}
    />
  );
}

function PressureScale() {
  return (
    <div className="measure-scale-wrap" aria-label="压力颜色刻度">
      <div className="measure-color-bar" />
      <div className="measure-scale-ticks" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ModeStepper() {
  return (
    <div className="measure-mode-stepper" aria-label="流程步骤">
      {MODE_STEPS.map((step, index) => (
        <div className="measure-mode-step" key={step.label}>
          <img src={step.icon} alt={step.label} />
          {index < MODE_STEPS.length - 1 && <span aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function LivePressureStrip({ progress }: { progress: number }) {
  const fill = `${Math.max(8, Math.round(progress * 100))}%`;

  return (
    <div className="measure-live-strip" aria-label="实时压力采集进度">
      <span>实时压力展示</span>
      <div className="measure-live-track">
        <i style={{ width: fill }} />
        <b style={{ left: fill }} />
      </div>
      <strong>{Math.round(progress * 100)}%</strong>
    </div>
  );
}

function WaveCard({
  title,
  value,
  unit,
  large = false,
}: {
  title: string;
  value: number;
  unit: string;
  large?: boolean;
}) {
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
          <path
            d="M0 36 C58 12 92 68 150 38 C209 7 245 64 320 14 L320 70 L0 70 Z"
            fill="url(#measureWaveGradient)"
          />
          <defs>
            <linearGradient id="measureWaveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffd177" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#fff1d4" stopOpacity="0.9" />
            </linearGradient>
          </defs>
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
}) {
  return (
    <section className="measure-panel">
      <h2>
        <span>{heading}</span>
        <small>{english}</small>
      </h2>
      <WaveCard large title={realtimeLabel} value={values.realtime} unit={unit} />
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
      ? "暂停测量"
      : state === "paused"
      ? "继续测量"
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
  const progressArcRef = useRef<SVGCircleElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const elapsedBeforeStartRef = useRef(0);
  const elapsedRef = useRef(0);
  const lastStateSyncRef = useRef(0);

  const isActive = collectState !== "idle";
  const progress = collectState === "done" ? 1 : Math.min(elapsedMs / TOTAL_DURATION_MS, 1);
  const remaining = Math.max(0, Math.ceil((TOTAL_DURATION_MS - elapsedMs) / 1000));

  const areaData = useMemo(
    () => ({
      realtime: isActive ? 132 : 0,
      average: isActive ? 132 : 0,
      peak: isActive ? 132 : 0,
      total: isActive ? 225 : 0,
    }),
    [isActive],
  );

  const pressureData = useMemo(
    () => ({
      realtime: isActive ? 132 : 0,
      average: isActive ? 132 : 0,
      peak: isActive ? 132 : 0,
      total: isActive ? 124452 : 0,
    }),
    [isActive],
  );

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
          ? "暂停测量"
          : state === "paused"
          ? "继续测量"
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

    if (collectState === "collecting") {
      stopRaf();
      elapsedBeforeStartRef.current = elapsedRef.current;
      setElapsedMs(elapsedRef.current);
      setCollectState("paused");
      return;
    }

    if (collectState === "idle") {
      elapsedBeforeStartRef.current = 0;
      elapsedRef.current = 0;
      setElapsedMs(0);
    }

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
      <TopNavBar currentStep={2} onHistoryClick={onHistory} />

      <main className="measure-main">
        <section className="measure-stage">
          <header className="measure-title">
            <div>
              <h1>实时压力展示</h1>
              <span>Real-time Pressure Monitoring</span>
            </div>
            <ModeStepper />
          </header>

          <div className="measure-visual">
            <PressureScale />

            <div className="measure-model">
              <FeetModel3D width="100%" height="100%" modelScale={modelScale} lockedView />
            </div>

            <div className="measure-control-panel" aria-hidden="true" />

            <div className="measure-controls">
              <ControlButton type="mode" active />
              <ControlButton type="plus" onClick={() => zoomModel(1)} />
              <ControlButton type="minus" onClick={() => zoomModel(-1)} />
              <ControlButton type="focus" onClick={resetModelView} />
              <ControlButton type="sliders" />
            </div>

            <LivePressureStrip progress={collectState === "idle" ? 0.55 : progress} />
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
          />
          <MetricPanel
            heading="压力"
            english="Pressure"
            realtimeLabel="实时压力"
            values={pressureData}
            unit="pa"
          />
        </aside>
      </main>

      <footer className="measure-footer">
        <div className="measure-footer-left">
          <DeviceStatusBadge />
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

      <style>{measureStyles}</style>
    </div>
  );
}

const measureStyles = `
  .measure-shell {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(255, 250, 240, 0.98) 0%, rgba(255, 255, 255, 0.98) 66%, #ffffff 100%),
      #fffdf8;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    color: #1f1f1f;
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
    background-size: 50px 50px;
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
    grid-template-columns: minmax(720px, 1fr) 594px;
    gap: 58px;
    min-height: calc(100vh - 88px);
    padding: 112px 80px 92px 92px;
    box-sizing: border-box;
  }

  .measure-stage {
    position: relative;
    min-width: 0;
  }

  .measure-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 28px;
    margin-bottom: 12px;
  }

  .measure-title h1 {
    margin: 0;
    font-size: 26px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: 0;
  }

  .measure-title span {
    display: block;
    margin-top: 4px;
    font-size: 16px;
    font-weight: 700;
  }

  .measure-mode-stepper {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 2px;
  }

  .measure-mode-step {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .measure-mode-step img {
    width: 28px;
    height: 28px;
    display: block;
  }

  .measure-mode-step span {
    width: 36px;
    height: 3px;
    border-radius: 999px;
    background: #f08614;
    margin: 0;
  }

  .measure-visual {
    position: relative;
    min-height: calc(100vh - 286px);
  }

  .measure-control-panel {
    position: absolute;
    right: 96px;
    top: 548px;
    width: 299px;
    height: 206px;
    border-radius: 8px;
    background: #ffffff;
    border: 1px solid #f79831;
    box-sizing: border-box;
    z-index: 2;
    pointer-events: none;
  }

  .measure-scale-wrap {
    position: absolute;
    left: 0;
    top: 132px;
    width: 30px;
    height: min(48vh, 470px);
  }

  .measure-color-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 18px;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(180deg, #ff8282 0%, #ff8400 19%, #ffc758 39%, #d1ffa4 61%, #6bcbff 100%);
    box-shadow: 0 10px 24px rgba(255, 132, 0, 0.14);
  }

  .measure-scale-ticks {
    position: absolute;
    inset: 0 0 0 18px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 3px 0;
  }

  .measure-scale-ticks span {
    width: 12px;
    height: 2px;
    border-radius: 999px;
    background: #f08614;
  }

  .measure-model {
    position: absolute;
    left: 72px;
    right: 260px;
    top: 34px;
    height: min(54vh, 560px);
    pointer-events: none;
  }

  .measure-controls {
    position: absolute;
    right: 178px;
    top: 382px;
    display: grid;
    gap: 10px;
    z-index: 5;
  }

  .measure-control {
    width: 46px;
    height: 46.3px;
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
    left: calc(50% - 190px);
    bottom: 10px;
    transform: translateX(-50%);
    z-index: 4;
  }

  .measure-live-strip {
    position: absolute;
    left: auto;
    right: 120px;
    top: 596px;
    bottom: auto;
    width: 251px;
    transform: none;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 6px 10px;
    color: #17191c;
    z-index: 4;
  }

  .measure-live-strip span {
    grid-column: 1 / -1;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    color: #5a3a1a;
    text-align: center;
  }

  .measure-live-strip strong {
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    color: #5a3a1a;
  }

  .measure-live-track {
    position: relative;
    height: 24px;
    border-radius: 999px;
    background: #dbc2a8;
    overflow: visible;
  }

  .measure-live-track i {
    position: absolute;
    left: 2px;
    top: 2px;
    bottom: 2px;
    max-width: calc(100% - 4px);
    border-radius: 999px;
    background: #f08614;
    transition: width 260ms ease;
  }

  .measure-live-track b {
    position: absolute;
    top: 4px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: #fff;
    transform: translateX(-50%);
    transition: left 260ms ease;
    box-shadow: 0 2px 8px rgba(160, 91, 28, 0.2);
  }

  .measure-countdown-button {
    position: relative;
    width: 174px;
    min-height: 150px;
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
    width: 118px;
    height: 118px;
    display: grid;
    place-items: center;
  }

  .measure-countdown-button svg {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 118px;
    height: 118px;
    transform: rotate(135deg);
    transform-origin: 50% 50%;
  }

  .measure-countdown-button.collecting svg {
    animation: measure-pulse-glow 1.6s ease-in-out infinite;
  }

  .countdown-track,
  .countdown-progress {
    fill: none;
    stroke-width: 8;
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
    width: 68px;
    height: 68px;
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
    width: 24px;
    height: 24px;
    border-radius: 4px;
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
    font-size: 18px;
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
    gap: 62px;
    padding-top: 98px;
  }

  .measure-panel h2 {
    display: flex;
    align-items: baseline;
    gap: 22px;
    margin: 0 0 18px;
  }

  .measure-panel h2 span {
    font-size: 28px;
    font-weight: 700;
    color: #17191c;
  }

  .measure-panel h2 small {
    font-size: 16px;
    font-weight: 800;
    color: #17191c;
  }

  .measure-card {
    min-height: 104px;
    border: 1px solid #ffbf7b;
    border-radius: 12px;
    background: linear-gradient(180deg, #ffffff 50%, #fff7ea 100%);
    box-shadow: 0 2px 6px rgba(220, 185, 146, 0.4);
    overflow: hidden;
    box-sizing: border-box;
  }

  .measure-card-large {
    height: 172px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.94);
  }

  .measure-card-top {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 34px 32px 0;
  }

  .measure-card:not(.measure-card-large) .measure-card-top {
    display: grid;
    justify-items: center;
    text-align: center;
    padding: 26px 10px 0;
  }

  .measure-card-top span {
    color: #17191c;
    font-size: 24px;
    font-weight: 800;
  }

  .measure-card:not(.measure-card-large) .measure-card-top span {
    order: 2;
    margin-top: 2px;
    color: #17191c;
    font-size: 17px;
    font-weight: 500;
  }

  .measure-card-top strong {
    color: #17191c;
    font-size: 26px;
    font-weight: 900;
  }

  .measure-card-top small {
    font-size: 18px;
    font-weight: 800;
  }

  .measure-card:not(.measure-card-large) .measure-card-top strong {
    font-size: 26px;
  }

  .measure-card-wave {
    width: 100%;
    height: 88px;
    margin-top: 16px;
    display: block;
  }

  .measure-card-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 9px;
  }

  .measure-footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 12;
    height: 76px;
    display: grid;
    grid-template-columns: 260px minmax(520px, auto);
    justify-content: space-between;
    align-items: center;
    padding: 0 80px;
    box-sizing: border-box;
    background: transparent;
  }

  .measure-footer-left,
  .measure-footer-right {
    display: flex;
    align-items: center;
    gap: 22px;
  }

  .measure-device-status {
    width: 136px;
    height: auto;
    display: block;
  }

  .measure-footer-right span {
    font-size: 16px;
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
    font-size: 16px;
    font-weight: 800;
    white-space: nowrap;
  }

  .measure-footer-right .primary-link {
    color: #ff8400;
  }

  @media (max-width: 1400px) {
    .measure-main {
      grid-template-columns: minmax(620px, 1fr) 520px;
      padding-left: 48px;
      padding-right: 48px;
      gap: 36px;
    }

    .measure-card-row {
      gap: 8px;
    }

    .measure-mode-stepper {
      gap: 8px;
    }

    .measure-mode-step {
      gap: 8px;
    }

    .measure-mode-step span {
      width: 22px;
    }

    .measure-footer {
      grid-template-columns: 190px minmax(430px, auto);
      padding: 0 42px;
    }

    .measure-footer-right {
      gap: 14px;
    }

    .measure-footer-right span,
    .measure-footer-right button {
      font-size: 14px;
    }
  }
`;
