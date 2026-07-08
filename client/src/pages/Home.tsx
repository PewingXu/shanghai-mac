import React, { useState } from "react";
import { useApp, User } from "@/contexts/AppContext";
import PageBackground from "@/components/PageBackground";
import TopNavBar from "@/components/TopNavBar";
import MeasurePage from "./MeasurePage";
import ReportPage from "./ReportPage";
import SolutionPage from "./SolutionPage";
import HistoryPage from "./HistoryPage";
import UserRecordsPage from "./UserRecordsPage";

// ─── 永久存储图标 URL ─────────────────────────────────────────────────────────
const ICONS = {
  closeIcon: "/assets/icons/form-page/close-icon.svg",
  dropdown: "/assets/icons/form-page/dropdown.svg",
};

// ─── 表单数据类型 ─────────────────────────────────────────────────────────────
interface UserFormData {
  name: string;
  birthDate: string;
  gender: string;
  height?: number;
  weight?: number;
}

// ─── 样式常量 ─────────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  color: "#6A4020",
  marginBottom: "8px",
  fontWeight: "500",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: "42px",
  borderRadius: "6px",
  border: "1.5px solid #E8C9A0",
  backgroundColor: "#FFFFFF",
  padding: "0 14px",
  fontSize: "14px",
  color: "#3D2000",
  outline: "none",
  boxSizing: "border-box",
};

// ─── 创建用户弹窗 ─────────────────────────────────────────────────────────────
function CreateUserDialog({
  userId,
  onClose,
  onSubmit,
}: {
  userId: number;
  onClose: () => void;
  onSubmit: (data: UserFormData) => void;
}) {
  const [name, setName] = useState("果果");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("女");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");

  const isFormValid = name.trim() !== "";

  const handleSubmit = () => {
    if (!isFormValid) return;
    onSubmit({
      name,
      birthDate,
      gender,
      height: height ? parseFloat(height) : undefined,
      weight: weight ? parseFloat(weight) : undefined,
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: "460px",
          backgroundColor: "#FFF8EE",
          borderRadius: "16px",
          padding: "40px 44px 36px",
          boxShadow: "0 12px 48px rgba(180, 100, 20, 0.15)",
          position: "relative",
          pointerEvents: "auto",
          animation: "dialogIn 0.25s cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        {/* 标题行 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "32px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: "600",
              color: "#3D2000",
              letterSpacing: "0.03em",
            }}
          >
            创建用户&nbsp;&nbsp;
            <span
              style={{
                fontWeight: "400",
                color: "#6A4020",
                fontSize: "20px",
              }}
            >
              （ID：{userId}）
            </span>
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.6,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.opacity = "1")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.opacity = "0.6")
            }
          >
            <img
              src={ICONS.closeIcon}
              alt="关闭"
              style={{ width: "18px", height: "18px" }}
            />
          </button>
        </div>

        {/* 第一行：姓名 + 出生年/月/日 */}
        <div style={{ display: "flex", gap: "20px", marginBottom: "24px" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              placeholder="请输入姓名"
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>出生年／月／日</label>
            <div style={{ position: "relative" }}>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                style={{
                  ...inputStyle,
                  paddingRight: "40px",
                  color: birthDate ? "#3D2000" : "#B8A090",
                }}
              />
              <img
                src={ICONS.dropdown}
                alt=""
                style={{
                  position: "absolute",
                  right: "14px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "14px",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>
        </div>

        {/* 第二行：性别 + 身高 + 体重 */}
        <div style={{ display: "flex", gap: "14px", marginBottom: "32px" }}>
          {/* 性别 */}
          <div style={{ flex: "0 0 110px" }}>
            <label style={labelStyle}>性别</label>
            <div style={{ position: "relative" }}>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                style={{
                  ...inputStyle,
                  appearance: "none" as const,
                  WebkitAppearance: "none" as const,
                  paddingRight: "36px",
                  cursor: "pointer",
                }}
              >
                <option value="女">女</option>
                <option value="男">男</option>
              </select>
              <img
                src={ICONS.dropdown}
                alt=""
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "14px",
                  pointerEvents: "none",
                }}
              />
            </div>
          </div>

          {/* 身高 */}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>身高</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="请填写身高"
                min={0}
                max={300}
              />
              <span
                style={{
                  fontSize: "14px",
                  color: "#7A5030",
                  whiteSpace: "nowrap",
                }}
              >
                cm
              </span>
            </div>
          </div>

          {/* 体重 */}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>体重</label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="请填写体重"
                min={0}
                max={500}
              />
              <span
                style={{
                  fontSize: "14px",
                  color: "#7A5030",
                  whiteSpace: "nowrap",
                }}
              >
                kg
              </span>
            </div>
          </div>
        </div>

        {/* 开始体验按钮 */}
        <button
          onClick={handleSubmit}
          disabled={!isFormValid}
          style={{
            width: "100%",
            height: "50px",
            borderRadius: "8px",
            border: "none",
            cursor: isFormValid ? "pointer" : "not-allowed",
            fontSize: "16px",
            fontWeight: "600",
            color: "#FFFFFF",
            backgroundColor: isFormValid ? "#B8906A" : "#C4B0A0",
            marginBottom: "14px",
            letterSpacing: "0.08em",
            transition: "background-color 0.2s, transform 0.1s",
          }}
          onMouseDown={(e) => {
            if (isFormValid)
              (e.currentTarget as HTMLButtonElement).style.transform =
                "scale(0.97)";
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          开始体验
        </button>

        {/* 取消按钮 */}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            height: "50px",
            borderRadius: "8px",
            border: "1.5px solid #F0C080",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "500",
            color: "#E8944A",
            backgroundColor: "rgba(255, 220, 150, 0.15)",
            letterSpacing: "0.08em",
            transition: "background-color 0.2s, transform 0.1s",
          }}
          onMouseDown={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              "scale(0.97)";
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ─── 首页（步骤1：创建用户） ──────────────────────────────────────────────────
function CreateUserPage({
  onSubmit,
  onHistory,
}: {
  onSubmit: (data: UserFormData) => void;
  onHistory: () => void;
}) {
  const [showDialog, setShowDialog] = useState(true);
  const [nextUserId] = useState(1234);

  const handleClose = () => setShowDialog(false);

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily:
          '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <PageBackground />
      <TopNavBar currentStep={1} onHistoryClick={onHistory} />

      <main
        style={{
          position: "relative",
          zIndex: 10,
          paddingTop: "88px",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!showDialog && (
          <div style={{ textAlign: "center" }}>
            <button
              onClick={() => setShowDialog(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(1.05)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.transform =
                  "scale(1)";
              }}
            >
              <div
                style={{
                  width: "160px",
                  height: "52px",
                  borderRadius: "26px",
                  backgroundColor: "#E8944A",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#FFFFFF",
                  letterSpacing: "0.08em",
                  boxShadow: "0 4px 16px rgba(232, 148, 74, 0.35)",
                }}
              >
                创建用户
              </div>
            </button>
          </div>
        )}
      </main>

      {showDialog && (
        <CreateUserDialog
          userId={nextUserId}
          onClose={handleClose}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

// ─── 主路由组件 ───────────────────────────────────────────────────────────────
type AppView = "create" | "measure" | "report" | "solution" | "history" | "userRecords";

export default function Home() {
  const { setCurrentUser, setCurrentStep, addHistoryUser } = useApp();
  const [view, setView] = useState<AppView>("create");
  const [prevView, setPrevView] = useState<AppView>("create");

  const handleCreateUser = (data: UserFormData) => {
    const newUser: User = {
      id: Math.floor(1000 + Math.random() * 9000),
      name: data.name,
      birthDate: data.birthDate,
      gender: data.gender,
      height: data.height,
      weight: data.weight,
    };
    setCurrentUser(newUser);
    addHistoryUser(newUser);
    setCurrentStep(2);
    setView("measure");
  };

  const handleGoToReport = () => {
    setCurrentStep(3);
    setView("report");
  };

  const handleGoToSolution = () => {
    setCurrentStep(4);
    setView("solution");
  };

  const handleRestart = () => {
    setCurrentUser(null);
    setCurrentStep(1);
    setView("create");
  };

  const handleShowHistory = () => {
    setPrevView(view);
    setView("history");
  };

  const handleSelectHistoryUser = (user: User) => {
    setCurrentUser(user);
    setPrevView("history");
    setView("userRecords");
  };

  const handleGoToMeasureFromRecords = () => {
    setCurrentStep(2);
    setView("measure");
  };

  const handleBackFromHistory = () => {
    setView(prevView);
  };

  // 渲染对应视图
  if (view === "userRecords") {
    return (
      <UserRecordsPage
        onBack={() => setView("history")}
        onStartMeasure={handleGoToMeasureFromRecords}
      />
    );
  }

  if (view === "history") {
    return (
      <HistoryPage
        onSelectUser={handleSelectHistoryUser}
        onBack={handleBackFromHistory}
      />
    );
  }

  if (view === "measure") {
    return (
      <MeasurePage onNext={handleGoToReport} onHistory={handleShowHistory} />
    );
  }

  if (view === "report") {
    return (
      <ReportPage onNext={handleGoToSolution} onHistory={handleShowHistory} onBack={() => setView("measure")} />
    );
  }

  if (view === "solution") {
    return (
      <SolutionPage
        onRestart={handleRestart}
        onHistory={handleShowHistory}
        onBack={() => { setCurrentStep(2); setView("measure"); }}
        onViewReport={() => { setCurrentStep(3); setView("report"); }}
      />
    );
  }

  // 默认：步骤1 创建用户
  return (
    <>
      <style>{`
        @keyframes dialogIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
        input[type="date"]::-webkit-calendar-picker-indicator {
          opacity: 0;
          width: 100%;
          position: absolute;
          left: 0;
          cursor: pointer;
        }
        input:focus, select:focus {
          border-color: #E8944A !important;
          box-shadow: 0 0 0 3px rgba(232, 148, 74, 0.15);
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>
      <CreateUserPage
        onSubmit={handleCreateUser}
        onHistory={handleShowHistory}
      />
    </>
  );
}
