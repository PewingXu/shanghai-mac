import React, { useState } from "react";

const LOGO_URL = "/assets/icons/home-page/top-left-logo.svg";

const STEPS = [
  { id: 1, label: "创建" },
  { id: 2, label: "测量" },
  { id: 3, label: "报告" },
  { id: 4, label: "方案" },
];

interface TopNavBarProps {
  currentStep: number;
  onHistoryClick?: () => void;
  showHistory?: boolean;
  /** 透明页眉：去掉填充背景/毛玻璃/底边线，让 Logo 与步骤条直接浮在页面背景上 */
  transparent?: boolean;
}

function HistoryButton({ onClick }: { onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        background: hovered ? "rgba(232, 148, 74, 0.12)" : "none",
        border: hovered ? "1.5px solid rgba(232, 148, 74, 0.5)" : "1.5px solid transparent",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "16px",
        fontWeight: "600",
        color: hovered ? "#C8682A" : "#E8944A",
        padding: "7px 18px",
        letterSpacing: "0.02em",
        transform: pressed ? "scale(0.95)" : hovered ? "scale(1.03)" : "scale(1)",
        transition: "all 0.18s cubic-bezier(0.23, 1, 0.32, 1)",
        boxShadow: hovered ? "0 2px 10px rgba(232, 148, 74, 0.2)" : "none",
      }}
    >
      历史用户
    </button>
  );
}

export default function TopNavBar({
  currentStep,
  onHistoryClick,
  showHistory = true,
  transparent = false,
}: TopNavBarProps) {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "88px",
        backgroundColor: transparent ? "transparent" : "rgba(255, 240, 210, 0.92)",
        backdropFilter: transparent ? "none" : "blur(12px)",
        borderBottom: transparent ? "none" : "1px solid rgba(203, 161, 115, 0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
        zIndex: 100,
      }}
    >
      {/* 左侧 Logo */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <img
          src={LOGO_URL}
          alt="ACIKI 动态足底压力解析系统"
          style={{ height: "56px", objectFit: "contain" }}
        />
      </div>

      {/* 右侧：步骤指示器 + 历史用户 */}
      <div style={{ display: "flex", alignItems: "center", gap: "40px" }}>
        {/* 步骤指示器 */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {STEPS.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <div
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    backgroundColor:
                      step.id === currentStep
                        ? "#E8944A"
                        : step.id < currentStep
                        ? "#C8784A"
                        : "transparent",
                    border:
                      step.id <= currentStep ? "none" : "1.5px solid #CBA173",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: step.id === currentStep ? "700" : "400",
                    color:
                      step.id <= currentStep ? "#FFFFFF" : "#CBA173",
                    transition: "all 0.3s ease",
                  }}
                >
                  {step.id}
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    color:
                      step.id === currentStep
                        ? "#E8944A"
                        : step.id < currentStep
                        ? "#C8784A"
                        : "#CBA173",
                    fontWeight: step.id === currentStep ? "600" : "400",
                    transition: "color 0.3s ease",
                  }}
                >
                  {step.label}
                </span>
              </div>

              {/* 连接线 */}
              {index < STEPS.length - 1 && (
                <div
                  style={{
                    width: "36px",
                    height: "1.5px",
                    backgroundColor:
                      step.id < currentStep ? "#C8784A" : "#CBA173",
                    marginBottom: "18px",
                    opacity: step.id < currentStep ? 0.8 : 0.4,
                    transition: "all 0.3s ease",
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* 历史用户按钮 */}
        {showHistory && (
          <HistoryButton onClick={onHistoryClick} />
        )}
      </div>
    </header>
  );
}
