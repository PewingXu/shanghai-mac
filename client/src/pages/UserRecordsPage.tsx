/**
 * UserRecordsPage — 用户采集信息子页面
 * 设计风格：橙色渐变背景，顶部用户信息卡，下方采集记录列表，右下角返回上一页
 */
import { useApp } from "@/contexts/AppContext";

interface UserRecordsPageProps {
  onBack: () => void;
  onStartMeasure: () => void;
}

export default function UserRecordsPage({ onBack, onStartMeasure }: UserRecordsPageProps) {
  const { currentUser, collectionRecords, removeCollectionRecord, setSelectedRecord } = useApp();

  const userRecords = collectionRecords.filter((r) => r.userId === currentUser?.id);

  const formatBirthDate = (d?: string) => {
    if (!d) return "—";
    return d.replace(/-/g, ".").replace(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/, "$1.$2.$3");
  };

  const handleRecordClick = (record: (typeof collectionRecords)[0]) => {
    setSelectedRecord(record);
    onStartMeasure();
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (window.confirm("确认删除该条采集记录？")) {
      removeCollectionRecord(id);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #F5C97A 0%, #F8D99A 30%, #FBE8C0 60%, #FDF5D8 100%)",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* 背景光晕 */}
      <div style={{ position: "absolute", top: "-10%", right: "-5%", width: "45%", height: "55%", background: "radial-gradient(ellipse, rgba(255,255,255,0.35) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "-5%", left: "-5%", width: "40%", height: "45%", background: "radial-gradient(ellipse, rgba(255,255,255,0.25) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* 顶部导航 */}
      <header style={{ padding: "18px 40px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", borderBottom: "1px solid rgba(255,255,255,0.4)", position: "relative", zIndex: 10 }}>
        <img src="/assets/icons/home-page/top-left-logo.svg" alt="ACIKI 动态足底压力解析系统" style={{ height: "48px" }} />
      </header>

      {/* 主内容 */}
      <main style={{ flex: 1, padding: "32px 48px 80px", position: "relative", zIndex: 1 }}>
        {/* 页面标题 */}
        <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#5A3A1A", marginBottom: "24px" }}>
          用户采集信息
        </h1>

        {/* 用户信息卡 */}
        <div style={{
          background: "linear-gradient(90deg, #F5A623 0%, #F8C96A 100%)",
          borderRadius: "14px",
          padding: "0",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(200,120,0,0.15)",
        }}>
          {/* 头像区 */}
          <div style={{ width: "80px", minWidth: "80px", height: "72px", background: "rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="13" r="7" fill="rgba(255,255,255,0.85)" />
              <ellipse cx="18" cy="30" rx="12" ry="7" fill="rgba(255,255,255,0.85)" />
            </svg>
          </div>
          {/* 用户信息 */}
          <div style={{ flex: 1, padding: "0 24px", display: "flex", alignItems: "center", gap: "48px" }}>
            <span style={{ fontSize: "16px", fontWeight: "700", color: "#fff" }}>用户：{currentUser?.name ?? "—"}</span>
            <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.9)" }}>性别：{currentUser?.gender ?? "—"}</span>
            <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.9)" }}>体重：{currentUser?.weight ?? "—"}kg</span>
            <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.9)" }}>生日：{formatBirthDate(currentUser?.birthDate)}</span>
          </div>
          {/* 编辑图标 */}
          <div style={{ padding: "0 24px" }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M15.5 3.5L18.5 6.5L7 18H4V15L15.5 3.5Z" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M13 6L16 9" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />
            </svg>
          </div>
        </div>

        {/* 采集记录列表 */}
        {userRecords.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#B07840", fontSize: "15px" }}>
            暂无采集记录，请先进行测量
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {userRecords.map((record, index) => (
              <div
                key={record.id}
                onClick={() => handleRecordClick(record)}
                style={{
                  background: "rgba(255,255,255,0.85)",
                  borderRadius: "12px",
                  padding: "0 24px",
                  height: "64px",
                  display: "flex",
                  alignItems: "center",
                  gap: "32px",
                  cursor: "pointer",
                  transition: "all 0.18s cubic-bezier(0.23,1,0.32,1)",
                  boxShadow: "0 1px 8px rgba(200,120,0,0.08)",
                  border: "1px solid rgba(245,166,35,0.15)",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.98)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(200,120,0,0.18)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.85)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 8px rgba(200,120,0,0.08)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                }}
              >
                {/* 序号 */}
                <span style={{ fontSize: "18px", fontWeight: "700", color: "#F5A623", minWidth: "24px" }}>
                  {index + 1}
                </span>
                {/* 日期 */}
                <span style={{ fontSize: "16px", fontWeight: "600", color: "#3A2A10", minWidth: "100px" }}>
                  {record.date}
                </span>
                {/* 时间 */}
                <span style={{ fontSize: "14px", color: "#8A6A40", minWidth: "80px" }}>
                  {record.time}
                </span>
                {/* 删除图标 */}
                <button
                  onClick={(e) => handleDelete(e, record.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "6px",
                    borderRadius: "6px",
                    transition: "background 0.15s",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(245,166,35,0.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  title="删除记录"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <rect x="2" y="4" width="14" height="1.5" rx="0.75" fill="#F5A623" />
                    <path d="M7 2h4a1 1 0 0 1 1 1v1H6V3a1 1 0 0 1 1-1Z" fill="#F5A623" />
                    <path d="M4 5.5l1 9.5a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l1-9.5" stroke="#F5A623" strokeWidth="1.2" fill="none" />
                    <line x1="7" y1="8" x2="7" y2="13" stroke="#F5A623" strokeWidth="1.2" />
                    <line x1="11" y1="8" x2="11" y2="13" stroke="#F5A623" strokeWidth="1.2" />
                  </svg>
                </button>

                {/* 右侧箭头 */}
                <div style={{ marginLeft: "auto" }}>
                  <svg width="10" height="18" viewBox="0 0 10 18" fill="none">
                    <path d="M1 1L9 9L1 17" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 返回上一页（右下角） */}
      <div style={{ position: "fixed", bottom: "28px", right: "48px", zIndex: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "600",
            color: "#F5A623",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
