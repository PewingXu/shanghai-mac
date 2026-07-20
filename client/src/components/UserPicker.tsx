/**
 * UserPicker — 正式采集前的"选择体验用户"全屏界面（设计稿三阶段）。
 *
 * 数据库已有用户时从采集页弹出（无用户则直接弹创建表单，不经过这里）：
 *  1. choice ：请选择您的体验用户 → 「历史用户」(默认高亮) / 「创建用户 +」
 *  2. search ：姓名 / ID 模糊搜索，下拉候选列表选择
 *  3. confirm：展示选中用户信息卡二次确认 → 右下"开始体验 >"进入采集
 *
 * 覆盖在采集页之上，自带暖白背景与透明页眉；"返回上一页"逐级回退。
 */
import { useMemo, useState } from "react";
import { useApp, type User } from "@/contexts/AppContext";
import { formatUserId, computeAge } from "@/lib/utils";
import PageBackground from "@/components/PageBackground";
import TopNavBar from "@/components/TopNavBar";

/** 候选行 / 确认卡的用户摘要："刘玉华（ID：00012） 女 32岁" */
function userSummary(u: User): string {
  const age = computeAge(u.birthDate);
  const parts = [`${u.name}（ID：${formatUserId(u.id)}）`];
  if (u.gender) parts.push(u.gender);
  if (age != null) parts.push(`${age}岁`);
  return parts.join("　");
}

export default function UserPicker({
  onConfirm,
  onCreateNew,
  onClose,
}: {
  /** 选定历史用户并点"开始体验"：由调用方 setCurrentUser 并继续采集/导入 */
  onConfirm: (user: User) => void;
  /** 点"创建用户"：由调用方切换到创建用户弹窗 */
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const { historyUsers } = useApp();
  const [stage, setStage] = useState<"choice" | "search" | "confirm">("choice");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<User | null>(null);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return historyUsers
      .filter((u) => u.name.toLowerCase().includes(q) || String(u.id).includes(q) || formatUserId(u.id).includes(q))
      .slice(0, 30);
  }, [historyUsers, query]);

  const back = () => {
    if (stage === "confirm") {
      setPicked(null);
      setStage("search");
    } else if (stage === "search") {
      setQuery("");
      setStage("choice");
    } else {
      onClose();
    }
  };

  return (
    <div className="user-picker-shell">
      <PageBackground />
      <TopNavBar currentStep={1} showHistory={false} transparent />

      <main className="user-picker-main">
        <p className="user-picker-title">请选择您的体验用户</p>

        {/* 阶段 1：历史用户（默认高亮）/ 创建用户 */}
        {stage === "choice" && (
          <div className="user-picker-choices">
            <button className="user-picker-primary" onClick={() => setStage("search")}>
              历史用户
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M13.2 7.4L9 12.4L6.8 10.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="user-picker-secondary" onClick={onCreateNew}>
              创建用户
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3.5V16.5M3.5 10H16.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {/* 阶段 2：模糊搜索（姓名 / ID）+ 候选下拉 */}
        {stage === "search" && (
          <div className="user-picker-search-wrap">
            <div className="user-picker-search-box">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入姓名 / ID 检索"
                autoFocus
              />
              {query && (
                <button className="user-picker-clear" onClick={() => setQuery("")} aria-label="清空">
                  ×
                </button>
              )}
            </div>
            {query.trim() && (
              <div className="user-picker-dropdown">
                {candidates.length === 0 ? (
                  <div className="user-picker-empty">未找到匹配的用户</div>
                ) : (
                  candidates.map((u) => (
                    <button
                      key={u.id}
                      className="user-picker-option"
                      onClick={() => {
                        setPicked(u);
                        setStage("confirm");
                      }}
                    >
                      {userSummary(u)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* 阶段 3：选中用户信息卡（二次确认） */}
        {stage === "confirm" && picked && (
          <div className="user-picker-confirm-card">{userSummary(picked)}</div>
        )}
      </main>

      {/* 右下角：确认 / 回退 */}
      <div className="user-picker-footer">
        {stage === "confirm" && picked ? (
          <button className="user-picker-go" onClick={() => onConfirm(picked)}>
            开始体验 <span className="user-picker-go-arrow">›</span>
          </button>
        ) : (
          <button className="user-picker-back" onClick={back}>
            返回上一页
          </button>
        )}
        {stage === "confirm" && (
          <button className="user-picker-back" onClick={back} style={{ marginLeft: "28px" }}>
            返回上一页
          </button>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .user-picker-shell {
    position: fixed;
    inset: 0;
    /* 必须盖过采集页的 TopNavBar（zIndex 100），否则两层页眉重叠 */
    z-index: 120;
    overflow: hidden;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  }

  .user-picker-main {
    position: relative;
    z-index: 10;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: clamp(200px, 30vh, 340px);
  }

  .user-picker-title {
    margin: 0 0 clamp(40px, 7vh, 76px);
    font-size: 22px;
    font-weight: 700;
    color: #17191c;
  }

  .user-picker-choices {
    display: flex;
    flex-direction: column;
    gap: 28px;
    width: min(505px, calc(100vw - 64px));
  }

  .user-picker-primary,
  .user-picker-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 112px;
    border-radius: 12px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 2px;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
  }

  /* 历史用户：默认高亮（设计稿橙色主按钮） */
  .user-picker-primary {
    border: none;
    background: #F98207;
    color: #ffffff;
    box-shadow: 0 8px 20px rgba(249, 130, 7, 0.28);
  }

  .user-picker-primary:hover {
    filter: brightness(1.05);
    transform: translateY(-1px);
  }

  .user-picker-secondary {
    border: 1.5px solid #F98207;
    background: #ffffff;
    color: #F98207;
  }

  .user-picker-secondary:hover {
    background: #fff6ea;
    transform: translateY(-1px);
  }

  /* 搜索框（设计稿：白底橙边圆角，内部下划线输入 + 清除 ×） */
  .user-picker-search-wrap {
    width: min(505px, calc(100vw - 64px));
    display: flex;
    flex-direction: column;
  }

  .user-picker-search-box {
    display: flex;
    align-items: center;
    background: #ffffff;
    border: 1.5px solid #F98207;
    border-radius: 12px;
    padding: 20px 26px;
  }

  .user-picker-search-box input {
    flex: 1;
    min-width: 0;
    border: none;
    border-bottom: 1.5px solid #d8cfc2;
    background: transparent;
    outline: none;
    font-size: 20px;
    padding: 4px 2px 8px;
    color: #17191c;
  }

  .user-picker-search-box input:focus {
    border-bottom-color: #F98207;
  }

  .user-picker-clear {
    flex-shrink: 0;
    margin-left: 14px;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: #d9d2c7;
    color: #ffffff;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }

  .user-picker-dropdown {
    margin-top: 10px;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(180, 130, 60, 0.18);
    max-height: 300px;
    overflow-y: auto;
    padding: 6px 0;
  }

  .user-picker-option {
    display: block;
    width: 100%;
    border: none;
    background: none;
    padding: 15px 34px;
    font-size: 17px;
    color: #3a3630;
    text-align: center;
    cursor: pointer;
    border-bottom: 1px solid #f3ede3;
  }

  .user-picker-option:last-child {
    border-bottom: none;
  }

  .user-picker-option:hover {
    background: #fff6ea;
    color: #F98207;
  }

  .user-picker-empty {
    padding: 22px 0;
    text-align: center;
    font-size: 15px;
    color: #b0a494;
  }

  /* 确认卡：单条用户信息（白底橙边） */
  .user-picker-confirm-card {
    width: min(505px, calc(100vw - 64px));
    box-sizing: border-box;
    padding: 24px 30px;
    border-radius: 12px;
    border: 1.5px solid #F98207;
    background: #ffffff;
    box-shadow: 0 6px 18px rgba(249, 130, 7, 0.12);
    font-size: 20px;
    font-weight: 600;
    color: #17191c;
    text-align: center;
  }

  .user-picker-footer {
    position: absolute;
    right: clamp(40px, 4vw, 76px);
    bottom: clamp(26px, 4vh, 44px);
    z-index: 10;
    display: flex;
    align-items: center;
  }

  .user-picker-back {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
    color: #FF8400;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .user-picker-go {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 20px;
    font-weight: 700;
    color: #FF8400;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .user-picker-go-arrow {
    font-size: 26px;
    line-height: 1;
  }
`;
