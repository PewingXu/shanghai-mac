import { useApp } from "@/contexts/AppContext";
import PageBackground from "@/components/PageBackground";
import TopNavBar from "@/components/TopNavBar";

interface SolutionPageProps {
  onRestart: () => void;
  onHistory: () => void;
}

const SOLUTIONS = [
  {
    id: 1,
    title: "定制矫形鞋垫",
    subtitle: "个性化足底压力分散方案",
    description:
      "根据您的足底压力分布数据，定制专属矫形鞋垫，有效分散前足压力，改善步态平衡。",
    tags: ["前足减压", "步态矫正", "定制化"],
    priority: "首选推荐",
    color: "#E8944A",
    icon: "👟",
  },
  {
    id: 2,
    title: "足弓支撑训练",
    subtitle: "6周渐进式足部强化计划",
    description:
      "针对轻度高弓足，提供系统性足弓强化训练方案，包括拉伸、强化和平衡训练。",
    tags: ["足弓强化", "平衡训练", "6周计划"],
    priority: "辅助方案",
    color: "#C8784A",
    icon: "🏃",
  },
  {
    id: 3,
    title: "步态分析随访",
    subtitle: "3个月动态追踪评估",
    description:
      "建立个人步态档案，每月进行一次复测，追踪改善进度，及时调整干预方案。",
    tags: ["定期复测", "进度追踪", "方案调整"],
    priority: "长期管理",
    color: "#A86030",
    icon: "📊",
  },
];

export default function SolutionPage({ onRestart, onHistory }: SolutionPageProps) {
  const { currentUser } = useApp();

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
      <TopNavBar currentStep={4} onHistoryClick={onHistory} showHistory={false} />

      <main
        style={{
          position: "relative",
          zIndex: 10,
          padding: "108px 48px 64px",
          minHeight: "100vh",
        }}
      >
        {/* 标题 */}
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto 32px",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: "700",
                color: "#3D2000",
              }}
            >
              个性化解决方案
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#9A7050" }}>
              基于 {currentUser?.name || "您"} 的足底压力分析结果，为您推荐以下方案
            </p>
          </div>
          <div
            style={{
              backgroundColor: "rgba(255, 248, 238, 0.9)",
              borderRadius: "10px",
              padding: "10px 20px",
              fontSize: "13px",
              color: "#7A5030",
            }}
          >
            生成时间：{new Date().toLocaleDateString("zh-CN")}
          </div>
        </div>

        {/* 方案卡片列表 */}
        <div
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {SOLUTIONS.map((solution, index) => (
            <div
              key={solution.id}
              style={{
                backgroundColor: "rgba(255, 248, 238, 0.9)",
                borderRadius: "16px",
                padding: "28px 32px",
                boxShadow: "0 4px 20px rgba(180, 100, 20, 0.1)",
                display: "flex",
                gap: "24px",
                alignItems: "flex-start",
                animation: `fadeInUp 0.4s ease ${index * 0.1}s both`,
              }}
            >
              {/* 序号 + 图标 */}
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "14px",
                  backgroundColor: `${solution.color}22`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "28px",
                  flexShrink: 0,
                }}
              >
                {solution.icon}
              </div>

              {/* 内容 */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: "8px",
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "17px",
                      fontWeight: "700",
                      color: "#3D2000",
                    }}
                  >
                    {solution.title}
                  </h3>
                  <span
                    style={{
                      fontSize: "11px",
                      color: solution.color,
                      backgroundColor: `${solution.color}22`,
                      padding: "3px 10px",
                      borderRadius: "20px",
                      fontWeight: "600",
                    }}
                  >
                    {solution.priority}
                  </span>
                </div>
                <p
                  style={{
                    margin: "0 0 12px",
                    fontSize: "13px",
                    color: "#9A7050",
                    fontWeight: "500",
                  }}
                >
                  {solution.subtitle}
                </p>
                <p
                  style={{
                    margin: "0 0 14px",
                    fontSize: "14px",
                    color: "#5A3820",
                    lineHeight: "1.6",
                  }}
                >
                  {solution.description}
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  {solution.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontSize: "11px",
                        color: "#9A7050",
                        backgroundColor: "rgba(203, 161, 115, 0.15)",
                        padding: "3px 10px",
                        borderRadius: "20px",
                        border: "1px solid rgba(203, 161, 115, 0.3)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* 操作按钮 */}
              <button
                style={{
                  height: "40px",
                  padding: "0 20px",
                  borderRadius: "8px",
                  border: `1.5px solid ${solution.color}`,
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: solution.color,
                  backgroundColor: "transparent",
                  flexShrink: 0,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.backgroundColor = `${solution.color}22`;
                }}
                onMouseLeave={(e) => {
                  const btn = e.currentTarget as HTMLButtonElement;
                  btn.style.backgroundColor = "transparent";
                }}
              >
                了解详情
              </button>
            </div>
          ))}
        </div>

        {/* 底部操作 */}
        <div
          style={{
            maxWidth: "960px",
            margin: "32px auto 0",
            display: "flex",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <button
            onClick={onRestart}
            style={{
              height: "50px",
              padding: "0 48px",
              borderRadius: "10px",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "600",
              color: "#FFFFFF",
              backgroundColor: "#E8944A",
              letterSpacing: "0.06em",
              transition: "background-color 0.2s, transform 0.1s",
              boxShadow: "0 4px 16px rgba(232, 148, 74, 0.3)",
            }}
            onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
          >
            新建用户
          </button>
          <button
            style={{
              height: "50px",
              padding: "0 40px",
              borderRadius: "10px",
              border: "1.5px solid #F0C080",
              cursor: "pointer",
              fontSize: "15px",
              fontWeight: "500",
              color: "#E8944A",
              backgroundColor: "rgba(255, 220, 150, 0.15)",
              letterSpacing: "0.04em",
            }}
          >
            打印方案
          </button>
        </div>
      </main>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
