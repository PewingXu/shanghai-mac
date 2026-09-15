import React, { useState } from "react";
import BrandLogo from "./BrandLogo";

const STEPS = [
  { id: 1, label: "创建" },
  { id: 2, label: "测量" },
  { id: 3, label: "报告" },
  { id: 4, label: "方案" },
];

// 步骤条统一用色：当前/已完成步骤同一颜色（取原两色中最浅的亮橙），不再深浅区分
const STEP_COLOR = "#1544A2";

interface TopNavBarProps {
  currentStep: number;
  onHistoryClick?: () => void;
  showHistory?: boolean;
  /** 透明页眉：去掉填充背景/毛玻璃/底边线，让 Logo 与步骤条直接浮在页面背景上 */
  transparent?: boolean;
  /** 点击已完成步骤（id < currentStep）回退到对应页面 */
  onStepClick?: (stepId: number) => void;
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
        background: hovered ? "rgba(21,68,162,0.12)" : "none",
        border: hovered ? "1.5px solid rgba(21,68,162,0.5)" : "1.5px solid transparent",
        borderRadius: "8px",
        cursor: "pointer",
        fontSize: "16px",
        fontWeight: "600",
        color: hovered ? "#1B3C7E" : "#1544A2",
        padding: "7px 18px",
        letterSpacing: "0.02em",
        transform: pressed ? "scale(0.95)" : hovered ? "scale(1.03)" : "scale(1)",
        transition: "all 0.18s cubic-bezier(0.23, 1, 0.32, 1)",
        boxShadow: hovered ? "0 2px 10px rgba(21,68,162,0.2)" : "none",
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
  onStepClick,
}: TopNavBarProps) {
  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "88px",
        backgroundColor: transparent ? "transparent" : "rgba(215,228,255,0.92)",
        backdropFilter: transparent ? "none" : "blur(12px)",
        borderBottom: transparent ? "none" : "1px solid rgba(115,144,203,0.2)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 48px",
        zIndex: 100,
      }}
    >
      {/* 左侧 Logo */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <BrandLogo size={52} />
      </div>

      {/* 右侧：步骤指示器 + 历史用户 */}
      <div style={{ display: "flex", alignItems: "center", gap: "40px" }}>
        {/* 步骤指示器 */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {STEPS.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                onClick={() => {
                  // 仅已完成的步骤可点击回退
                  if (step.id < currentStep && onStepClick) onStepClick(step.id);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                  cursor: step.id < currentStep && onStepClick ? "pointer" : "default",
                }}
              >
                <div
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "50%",
                    backgroundColor:
                      step.id <= currentStep ? STEP_COLOR : "transparent",
                    border:
                      step.id <= currentStep ? "none" : "1.5px solid #7390CB",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "13px",
                    fontWeight: step.id === currentStep ? "700" : "400",
                    color:
                      step.id <= currentStep ? "#FFFFFF" : "#7390CB",
                    transition: "all 0.3s ease",
                  }}
                >
                  {step.id}
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    color: step.id <= currentStep ? STEP_COLOR : "#7390CB",
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
                      step.id < currentStep ? STEP_COLOR : "#7390CB",
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
