import React, { useEffect, useRef, useState } from "react";
import { useApp } from "@/contexts/AppContext";
import { deviceManager } from "@/lib/deviceManager";
import MeasurePage from "./MeasurePage";
import ReportPage from "./ReportPage";
import SolutionPage from "./SolutionPage";
import RecordsPage from "./RecordsPage";
import ExceptionModal, { type ExceptionType } from "@/components/ExceptionModal";
import type { MeasureAnalysis } from "@/contexts/AppContext";
import BrandLogo, { BRAND_LOGO_URL, BRAND_NAME } from "@/components/BrandLogo";

const HOME_ASSETS = {
  stepIndicator: "/assets/icons/home-page/step-indicator.svg",
  userManagement: "/assets/icons/home-page/user-management.svg",
  deviceConnected: "/assets/icons/home-page/device-connected.svg",
  deviceDisconnected: "/assets/icons/home-page/device-disconnected.svg",
  hourglassLeft: "/assets/icons/home-page/hourglass-left.svg",
  hourglassRight: "/assets/icons/home-page/hourglass-right.svg",
};

type AppView =
  | "landing"
  | "create"
  | "measure"
  | "report"
  | "solution"
  | "history";

interface UserFormData {
  name: string;
  birthDate: string;
  gender: string;
  height?: number;
  weight?: number;
}

type SerialNavigator = Navigator & {
  serial?: EventTarget & {
    getPorts?: () => Promise<unknown[]>;
  };
};

function useDeviceConnectionStatus() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // 只反映 App 真实的连接状态（连接设备时通过事件/localStorage 广播）。
    // 注意：navigator.serial.getPorts() 返回的是"曾授权过"的串口，不代表当前已连接，
    // 因此这里不再用它判断，默认未连接，避免误报"设备连接正常"。
    const applyStored = () => {
      const stored = window.localStorage.getItem("aciki-device-connected");
      setConnected(stored === "true");
    };
    applyStored();

    const handleCustomStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ connected?: boolean }>).detail;
      if (typeof detail?.connected === "boolean") setConnected(detail.connected);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "aciki-device-connected") applyStored();
    };

    window.addEventListener("aciki-device-status", handleCustomStatus);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("aciki-device-status", handleCustomStatus);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return connected;
}

function HomeBackground() {
  return (
    <>
      <div className="home-gradient-base" />
      <img
        className="home-hourglass home-hourglass-left"
        src={HOME_ASSETS.hourglassLeft}
        alt=""
        aria-hidden="true"
      />
      <img
        className="home-hourglass home-hourglass-right"
        src={HOME_ASSETS.hourglassRight}
        alt=""
        aria-hidden="true"
      />
    </>
  );
}

function DeviceStatusBadge({ connected }: { connected: boolean }) {
  return (
    <img
      className="home-device-status"
      src={connected ? HOME_ASSETS.deviceConnected : HOME_ASSETS.deviceDisconnected}
      alt={connected ? "设备连接正常" : "设备连接异常"}
    />
  );
}

function LandingPage({
  onStart,
  onHistory,
  connecting,
}: {
  onStart: () => void;
  onHistory: () => void;
  connecting: boolean;
}) {
  const deviceConnected = useDeviceConnectionStatus();

  // 首页极简：纯白底，正中一枚大 logo 即「开始体验」按钮；右上角保留体验记录入口
  return (
    <div className="home-page-shell home-landing">
      <button className="home-user-link home-landing-user" onClick={onHistory} aria-label="体验记录">
        体验记录
      </button>

      <main className="home-landing-main">
        <button className="home-logo-start" onClick={onStart} aria-label="点击进入系统" title="点击进入系统">
          <img src={BRAND_LOGO_URL} alt={BRAND_NAME} draggable={false} />
          <span className="home-logo-start-name">{BRAND_NAME}</span>
        </button>
        <p className={`home-connect-hint${connecting ? " is-on" : ""}`}>
          {connecting ? "正在后台连接足垫设备，可直接点击 Logo 进入" : "点击 Logo 进入系统"}
        </p>
      </main>

      <footer className="home-footer">
        <DeviceStatusBadge connected={deviceConnected} />
      </footer>
    </div>
  );
}

function CreateUserPage({
  onSubmit,
  onBack,
  onHistory,
}: {
  onSubmit: (data: UserFormData) => void;
  onBack: () => void;
  onHistory: () => void;
}) {
  const [name, setName] = useState("果果");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("女");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const canSubmit = name.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    onSubmit({
      name: name.trim(),
      birthDate,
      gender,
      height: height ? Number(height) : undefined,
      weight: weight ? Number(weight) : undefined,
    });
  };

  return (
    <div className="home-page-shell">
      <HomeBackground />

      <header className="home-header">
        <button className="home-logo-button" onClick={onBack} aria-label="返回首页">
          <BrandLogo className="home-brand-logo" size={64} />
        </button>
        <div className="home-header-actions">
          <img className="home-step-indicator" src={HOME_ASSETS.stepIndicator} alt="创建 测量 报告 方案" />
          <button className="home-user-button" onClick={onHistory} aria-label="体验记录">
            <img src={HOME_ASSETS.userManagement} alt="体验记录" />
          </button>
        </div>
      </header>

      <main className="create-page-main">
        <form className="create-user-panel" onSubmit={submit}>
          <div className="create-panel-head">
            <div>
              <h1>创建用户</h1>
              <p>填写基础信息后开始足底压力测量</p>
            </div>
            <button type="button" className="create-close-button" onClick={onBack} aria-label="关闭">
              ×
            </button>
          </div>

          <div className="create-form-grid">
            <label>
              <span>姓名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入姓名" />
            </label>
            <label>
              <span>出生日期</span>
              <input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
            </label>
            <label>
              <span>性别</span>
              <select value={gender} onChange={(event) => setGender(event.target.value)}>
                <option value="女">女</option>
                <option value="男">男</option>
              </select>
            </label>
            <label>
              <span>身高 cm</span>
              <input
                type="number"
                min="0"
                max="300"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                placeholder="请输入身高"
              />
            </label>
            <label>
              <span>体重 kg</span>
              <input
                type="number"
                min="0"
                max="500"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                placeholder="请输入体重"
              />
            </label>
          </div>

          <div className="create-actions">
            <button type="button" onClick={onBack}>
              取消
            </button>
            <button type="submit" disabled={!canSubmit}>
              开始体验
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default function Home() {
  const { setCurrentUser, setCurrentStep, createUser, setAnalysis } = useApp();

  // 后台分析完成兜底入库：即使测量页已被切走，报告数据也不丢
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent<MeasureAnalysis>).detail;
      if (detail) setAnalysis(detail);
    };
    window.addEventListener("aciki-analysis-done", h);
    return () => window.removeEventListener("aciki-analysis-done", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 开发调试：URL 加 ?view=report 可直达对应页面（不影响正常流程）
  const [view, setView] = useState<AppView>(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    return ["landing", "create", "measure", "report", "solution", "history"].includes(v ?? "")
      ? (v as AppView)
      : "landing";
  });
  const [prevView, setPrevView] = useState<AppView>("landing");

  // ===== 进入系统即自动按设备码连接足垫（无需手势，走已授权端口） =====
  // 只做后台连接（首页徽章变"设备连接正常"），不自动跳页——进入采集由用户点"开始体验"。
  const [deviceConnecting, setDeviceConnecting] = useState(false);

  useEffect(() => {
    let disposed = false;
    setDeviceConnecting(true);
    void deviceManager.autoConnect().finally(() => {
      if (!disposed) setDeviceConnecting(false);
    });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点 Logo 进入采集页：不等连接结果、不弹授权框。足垫连接在后台继续
  // （桥模式常驻重扫），采集页有「连接设备」按钮可手动重试；未连接时点「开始测量」才提示。
  const handleStartExperience = () => {
    void deviceManager.autoConnect().catch(() => {});
    setCurrentStep(2);
    setView("measure");
  };

  const handleCreateUser = async (data: UserFormData) => {
    // 走后端持久化创建（服务端保证 id 唯一；后端不可用时 createUser 内部本地兜底）
    const newUser = await createUser({
      name: data.name,
      birthDate: data.birthDate,
      gender: data.gender,
      height: data.height,
      weight: data.weight,
    });
    setCurrentUser(newUser);
    setCurrentStep(2);
    setView("measure");
  };

  const handleShowHistory = () => {
    setPrevView(view);
    setView("history");
  };

  // "结束体验"统一出口（测量/报告/方案页共用）：清当前用户，直接回首页。
  // 不是流程"下一步"——用户在任何一步点结束都应立刻退出整个体验。
  const endExperience = () => {
    setCurrentUser(null);
    setCurrentStep(1);
    setView("landing");
  };

  const handleBackFromHistory = () => {
    setView(prevView);
  };

  // 顶部步骤条点击已完成步骤 → 回退到对应页面
  const goToStep = (step: number) => {
    if (step === 1) {
      setCurrentStep(1);
      setView("create");
    } else if (step === 2) {
      setCurrentStep(2);
      setView("measure");
    } else if (step === 3) {
      setCurrentStep(3);
      setView("report");
    }
  };

  // 全局异常弹窗（除首页外，任意页面运行时检测到异常即弹出，优先级最高）
  const [exception, setException] = useState<ExceptionType | null>(null);
  const isHome = view === "landing" || view === "create";

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: ExceptionType }>).detail;
      if (detail?.type) setException(detail.type);
    };
    window.addEventListener("aciki-exception", handler);
    return () => window.removeEventListener("aciki-exception", handler);
  }, []);
  useEffect(() => {
    if (isHome) setException(null); // 首页不弹异常窗
  }, [isHome]);

  const renderView = () => {
    if (view === "history") {
      return (
        <RecordsPage
          onBack={handleBackFromHistory}
          onOpenReport={() => {
            setCurrentStep(3);
            setView("report");
          }}
        />
      );
    }
    if (view === "measure") {
      return (
        <MeasurePage
          onNext={() => {
            setCurrentStep(3);
            setView("report");
          }}
          onEnd={endExperience}
          onHistory={handleShowHistory}
          onStepBack={goToStep}
        />
      );
    }
    if (view === "report") {
      return (
        <ReportPage
          onBack={() => setView("measure")}
          onNext={() => {
            setCurrentStep(4);
            setView("solution");
          }}
          onEnd={endExperience}
          onHistory={handleShowHistory}
          onStepBack={goToStep}
        />
      );
    }
    if (view === "solution") {
      return (
        <SolutionPage
          onHistory={handleShowHistory}
          onRestart={endExperience}
          onBack={() => {
            setCurrentStep(2);
            setView("measure");
          }}
          onViewReport={() => {
            setCurrentStep(3);
            setView("report");
          }}
        />
      );
    }
    return (
      <>
        <style>{homeStyles}</style>
        {view === "create" ? (
          <CreateUserPage
            onBack={() => setView("landing")}
            onHistory={handleShowHistory}
            onSubmit={handleCreateUser}
          />
        ) : (
          <LandingPage
            onStart={handleStartExperience}
            onHistory={handleShowHistory}
            connecting={deviceConnecting}
          />

        )}
      </>
    );
  };

  return (
    <>
      {renderView()}
      {!isHome && <ExceptionModal type={exception} onClose={() => setException(null)} />}
    </>
  );
}

const homeStyles = `
  .home-page-shell {
    position: relative;
    width: 100%;
    min-height: 100vh;
    overflow: hidden;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    color: #1f2933;
    isolation: isolate;
  }

  .home-gradient-base {
    position: fixed;
    inset: 0;
    z-index: -3;
    background:
      linear-gradient(180deg, rgba(189,211,255,0.86) 0%, rgba(239,244,255,0.96) 48%, #d4ddee 100%),
      linear-gradient(180deg, #dde4f3 0%, #d4ddee 100%);
  }

  .home-hourglass {
    position: fixed;
    z-index: -2;
    pointer-events: none;
    user-select: none;
    mix-blend-mode: multiply;
  }

  .home-hourglass-left {
    left: -16.25vw;
    top: -1.3vh;
    width: 31.56vw;
    max-width: 606px;
    height: auto;
    opacity: 0.6;
  }

  .home-hourglass-right {
    right: -6.4vw;
    top: -43.2vh;
    width: 42.92vw;
    min-width: 720px;
    height: auto;
    transform: rotate(180deg);
    opacity: 1;
    filter: drop-shadow(0 6px 50px rgba(226,235,252,0.16));
  }

  .home-header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: clamp(28px, 4.72vh, 51px) clamp(48px, 4.22vw, 81px) 0;
  }

  .home-brand-logo {
    display: inline-flex;
  }

  /* ── 首页（landing）：纯白底 + 大 logo 按钮 ── */
  .home-landing {
    background: #ffffff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .home-landing-user {
    position: fixed;
    top: clamp(28px, 4.72vh, 51px);
    right: clamp(48px, 4.22vw, 81px);
    z-index: 2;
  }

  .home-landing-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
  }

  .home-logo-start {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(20px, 3vh, 36px);
    padding: 24px;
    border: 0;
    border-radius: 48px;
    background: transparent;
    cursor: pointer;
    transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1), filter 200ms ease;
  }

  .home-logo-start img {
    display: block;
    width: clamp(220px, 26vw, 420px);
    height: auto;
    user-select: none;
    filter: drop-shadow(0 18px 40px rgba(0, 53, 155, 0.22));
    transition: filter 200ms ease;
  }

  .home-logo-start-name {
    font-size: clamp(34px, 3.4vw, 60px);
    font-weight: 700;
    letter-spacing: 0.18em;
    color: #00359b;
    line-height: 1;
  }

  .home-logo-start:hover {
    transform: translateY(-4px) scale(1.03);
  }

  .home-logo-start:hover img {
    filter: drop-shadow(0 26px 56px rgba(0, 53, 155, 0.32));
  }

  .home-logo-start:active {
    transform: scale(0.97);
  }

  .home-logo-start:disabled {
    cursor: wait;
    opacity: 0.92;
    transform: none;
  }

  .home-connect-hint.is-on {
    color: #00359b;
  }

  .home-logo-button,
  .home-user-button {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .home-start-button:disabled {
    opacity: 0.6;
    pointer-events: none;
  }

  .home-connect-hint {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: #8c96ad;
  }

  .home-connect-hint.is-error {
    color: #d64545;
  }

  .home-logo-button {
    display: block;
  }

  .home-header-actions {
    display: flex;
    align-items: flex-start;
    gap: clamp(28px, 2.6vw, 50px);
  }

  .home-step-indicator {
    display: block;
    width: min(13.39vw, 257px);
    min-width: 190px;
    height: auto;
  }

  .home-user-button {
    width: min(5vw, 96px);
    min-width: 84px;
    transition: transform 160ms ease, opacity 160ms ease;
  }

  /* 设计稿：landing 页"体验记录"为橙色下划线文字链接 */
  .home-user-link {
    padding: 0;
    border: 0;
    background: transparent;
    font-size: clamp(15px, 0.94vw, 18px);
    font-weight: 700;
    color: #0a3997;
    text-decoration: underline;
    text-underline-offset: 5px;
    cursor: pointer;
    transition: transform 160ms ease, opacity 160ms ease;
  }

  .home-user-link:hover {
    opacity: 0.85;
  }

  .home-user-button:hover,
  .home-start-button:hover {
    transform: translateY(-1px);
  }

  .home-user-button:active,
  .home-start-button:active {
    transform: translateY(1px) scale(0.99);
  }

  .home-user-button img {
    display: block;
    width: 100%;
    height: auto;
  }

  /* 设计稿：标语与按钮整体水平居中（标语 720 宽居中，按钮 top 540 居中） */
  .home-hero {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-top: clamp(160px, 24vh, 280px);
  }

  .home-hero-slogan {
    margin: 0;
    font-size: clamp(30px, 2.24vw, 43px);
    font-style: italic;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
    color: #17191c;
  }

  /* 设计稿按钮：287×89、圆角 30、#0A3997 底、4px 金橙渐变描边（border-image 不支持
     圆角，用 padding-box/border-box 双层背景实现）、白字 */
  .home-start-button {
    display: block;
    width: clamp(230px, 14.95vw, 287px);
    height: clamp(70px, 8.24vh, 89px);
    margin-top: clamp(48px, 8.3vh, 90px);
    border: 4px solid transparent;
    border-radius: 30px;
    background:
      linear-gradient(#0a3997, #0a3997) padding-box,
      linear-gradient(122deg, #457ae4 9%, #1f5dd9 81%) border-box;
    color: #ffffff;
    font-size: clamp(20px, 1.25vw, 24px);
    font-weight: 700;
    letter-spacing: 4px;
    cursor: pointer;
    transition: transform 160ms ease, filter 160ms ease;
    filter: drop-shadow(0 10px 22px rgba(10,57,151,0.3));
  }

  .home-footer {
    position: fixed;
    left: clamp(48px, 4.22vw, 81px);
    bottom: clamp(32px, 4.72vh, 51px);
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .home-device-status {
    display: block;
    width: min(7.1vw, 136px);
    min-width: 126px;
    height: auto;
  }

  .create-page-main {
    position: relative;
    z-index: 1;
    min-height: calc(100vh - 110px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 72px 32px 80px;
  }

  .create-user-panel {
    width: min(620px, calc(100vw - 64px));
    border-radius: 16px;
    background: rgba(243,247,255,0.94);
    box-shadow: 0 24px 70px rgba(24,55,118,0.14);
    border: 1px solid rgba(255, 255, 255, 0.76);
    padding: 34px 38px 32px;
  }

  .create-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }

  .create-panel-head h1 {
    margin: 0;
    font-size: 24px;
    line-height: 1.2;
    color: #2d3138;
    font-weight: 700;
    letter-spacing: 0;
  }

  .create-panel-head p {
    margin: 8px 0 0;
    color: #58698b;
    font-size: 14px;
  }

  .create-close-button {
    width: 34px;
    height: 34px;
    border: 1px solid rgba(0,53,159,0.18);
    border-radius: 8px;
    color: #00359f;
    background: #eff4ff;
    font-size: 24px;
    line-height: 28px;
  }

  .create-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px 20px;
  }

  .create-form-grid label {
    display: grid;
    gap: 8px;
    color: #37496e;
    font-size: 13px;
    font-weight: 600;
  }

  .create-form-grid input,
  .create-form-grid select {
    width: 100%;
    height: 44px;
    border-radius: 8px;
    border: 1px solid rgba(115,144,203,0.42);
    background: rgba(255, 255, 255, 0.9);
    padding: 0 13px;
    color: #2d3138;
    font-size: 14px;
    outline: none;
  }

  .create-form-grid input:focus,
  .create-form-grid select:focus {
    border-color: #003cb4;
    box-shadow: 0 0 0 3px rgba(0,53,159,0.13);
  }

  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 30px;
  }

  .create-actions button {
    min-width: 124px;
    height: 44px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
  }

  .create-actions button:first-child {
    border: 1px solid rgba(0,53,159,0.32);
    background: rgba(255, 255, 255, 0.6);
    color: #00359f;
  }

  .create-actions button:last-child {
    border: 0;
    background: #00359f;
    color: #fff;
    box-shadow: 0 8px 18px rgba(0,53,159,0.2);
  }

  .create-actions button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 980px) {
    .home-header {
      align-items: center;
      padding: 28px 28px 0;
    }

    .home-header-actions {
      gap: 16px;
    }

    .home-step-indicator {
      display: none;
    }

    .home-user-button {
      width: 82px;
      min-width: 82px;
    }

    .home-hero {
      width: auto;
      margin: 22vh 28px 0;
    }

    .home-hero-title {
      width: min(76vw, 560px);
      min-width: 0;
    }

    .home-start-button {
      width: 224px;
      min-width: 0;
      margin-top: 32px;
    }

    .home-hourglass-left {
      left: -31vw;
      width: 56vw;
      max-width: 360px;
    }

    .home-hourglass-right {
      right: -360px;
      width: 760px;
    }

    .home-footer {
      left: 28px;
      bottom: 28px;
    }

    .create-form-grid {
      grid-template-columns: 1fr;
    }
  }
`;
