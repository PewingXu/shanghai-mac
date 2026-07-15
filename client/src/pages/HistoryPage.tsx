import React, { useState, useMemo } from "react";
import { useApp, User } from "@/contexts/AppContext";
import PageBackground from "@/components/PageBackground";
import TopNavBar from "@/components/TopNavBar";

const PAGE_SIZE = 12; // 每页 12 个（3 列 × 4 行）

/** 由生日算年龄（无生日返回 null） */
function computeAge(birth?: string): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 200 ? age : null;
}

// ─── 左侧橙色渐变头像块（人像图标） ───────────────────────────────────────────
function UserAvatar() {
  return (
    <div
      style={{
        width: "82px",
        flexShrink: 0,
        alignSelf: "stretch",
        // 设计稿：194deg 暖橙渐变
        background: "linear-gradient(194deg, rgba(255,225,165,0.7) -14%, rgba(255,151,39,0.7) 64%, rgba(255,242,206,0.56) 99%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="40" height="40" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="13" r="7" fill="rgba(255,255,255,0.95)" />
        <path
          d="M4 32c0-7.732 6.268-14 14-14s14 6.268 14 14"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ─── 单条字段：标签(小/浅) + 值(大/深) ───────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: "14px", fontWeight: 300, color: "#8a8275", whiteSpace: "nowrap" }}>
      {label}
      <span style={{ fontSize: "18px", fontWeight: 500, color: "#17191C", marginLeft: "2px" }}>{value}</span>
    </span>
  );
}

// ─── 用户卡片（设计稿：白/暖渐变底 + 左侧橙色头像块 + 姓名(ID) + 性别/鞋码/年龄） ──
function UserCard({
  user,
  selected,
  onSelect,
  onClick,
}: {
  user: User;
  selected: boolean;
  onSelect: (id: number) => void;
  onClick: (user: User) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const age = computeAge(user.birthDate);

  return (
    <div
      onClick={() => onClick(user)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "stretch",
        height: "108px",
        borderRadius: "12px",
        overflow: "hidden",
        cursor: "pointer",
        position: "relative",
        // 设计稿：201deg 白→暖白渐变
        background: "linear-gradient(201deg, #fff5e3 6%, #ffffff 38%)",
        border: selected ? "2px solid #FF8400" : "1px solid #FFCB7D",
        boxShadow: hovered
          ? "0 4px 12px rgba(232,202,169,0.85)"
          : "0 2px 6px rgba(232,202,169,0.6)",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition: "all 0.18s cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      <UserAvatar />

      <div style={{ flex: 1, minWidth: 0, padding: "0 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "12px" }}>
        {/* 姓名 + 唯一 ID */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#17191C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user.name}
          </span>
          <span style={{ fontSize: "14px", fontWeight: 400, color: "#b09a7a", whiteSpace: "nowrap", flexShrink: 0 }}>
            （ID:{user.id}）
          </span>
        </div>
        {/* 性别 / 鞋码 / 年龄（鞋码暂占位） */}
        <div style={{ display: "flex", gap: "22px", alignItems: "baseline", flexWrap: "wrap" }}>
          <Field label="性别：" value={user.gender || "—"} />
          <Field label="鞋码：" value="—" />
          <Field label="年龄：" value={age != null ? `${age}岁` : "—"} />
        </div>
      </div>

      {/* 右箭头 */}
      <div style={{ display: "flex", alignItems: "center", paddingRight: "18px", flexShrink: 0 }}>
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" style={{ opacity: hovered ? 1 : 0.55, transform: hovered ? "translateX(2px)" : "none", transition: "all 0.15s" }}>
          <path d="M1 1L9 8L1 15" stroke="#FF8400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* 选择框（hover / 选中时显示，右上角） */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelect(user.id);
        }}
        style={{
          position: "absolute",
          top: "10px",
          right: "10px",
          width: "18px",
          height: "18px",
          borderRadius: "4px",
          border: selected ? "2px solid #FF8400" : "2px solid rgba(200,160,100,0.55)",
          backgroundColor: selected ? "#FF8400" : "rgba(255,255,255,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: hovered || selected ? 1 : 0,
          transition: "all 0.15s",
          zIndex: 2,
        }}
      >
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

// ─── 分页点 ───────────────────────────────────────────────────────────────────
function PageDots({ total, current, onDotClick }: { total: number; current: number; onDotClick: (page: number) => void }) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onDotClick(i)}
          style={{
            width: i === current ? "22px" : "10px",
            height: "10px",
            borderRadius: "5px",
            backgroundColor: i === current ? "#FF8400" : "rgba(255,132,0,0.28)",
            border: "none",
            cursor: "pointer",
            padding: 0,
            transition: "all 0.25s cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        />
      ))}
    </div>
  );
}

// ─── 用户管理页面主体 ─────────────────────────────────────────────────────────
export default function HistoryPage({
  onSelectUser,
  onBack,
}: {
  onSelectUser: (user: User) => void;
  onBack: () => void;
}) {
  const { historyUsers, removeHistoryUsers } = useApp();
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const deviceConnected =
    typeof window !== "undefined" && window.localStorage.getItem("aciki-device-connected") !== "false";

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return historyUsers;
    return historyUsers.filter((u) => u.name.toLowerCase().includes(q) || String(u.id).includes(q));
  }, [historyUsers, searchText]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages - 1);
  const pageUsers = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    removeHistoryUsers(Array.from(selectedIds));
    setSelectedIds(new Set());
    setDeleteConfirm(false);
    setCurrentPage(0);
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setCurrentPage(0);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        position: "relative",
        overflow: "hidden",
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <PageBackground />
      <TopNavBar currentStep={0} showHistory={false} />

      <main
        style={{
          position: "relative",
          zIndex: 10,
          padding: "108px 64px 90px",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 标题行 + 右侧搜索/删除 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "26px" }}>
          <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#3D2000", letterSpacing: "0.04em" }}>用户管理</h1>

          <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
            {/* 搜索框（内含 查询） */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "rgba(255,255,255,0.9)",
                borderRadius: "28px",
                border: "1.5px solid rgba(203,161,115,0.45)",
                padding: "0 8px 0 20px",
                height: "48px",
                gap: "10px",
                width: "340px",
                boxSizing: "border-box",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                <circle cx="6.5" cy="6.5" r="5" stroke="#7A5030" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="#7A5030" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={handleSearch}
                placeholder="搜索姓名 / ID"
                style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#3D2000" }}
              />
              <button
                onClick={() => setCurrentPage(0)}
                style={{ flexShrink: 0, height: "36px", padding: "0 16px", borderRadius: "20px", border: "none", cursor: "pointer", fontSize: "14px", fontWeight: 600, color: "#fff", background: "linear-gradient(90deg,#ff9a2e,#ff8400)" }}
              >
                查询
              </button>
            </div>

            {/* 删除用户 */}
            <button
              onClick={handleDelete}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                height: "48px",
                padding: "0 22px",
                borderRadius: "28px",
                border: deleteConfirm ? "1.5px solid #E05030" : "1.5px solid rgba(203,161,115,0.5)",
                backgroundColor: deleteConfirm ? "rgba(224,80,48,0.1)" : "rgba(255,255,255,0.9)",
                cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                opacity: selectedIds.size > 0 ? 1 : 0.55,
                fontSize: "14px",
                fontWeight: 600,
                color: deleteConfirm ? "#E05030" : "#7A5030",
                transition: "all 0.18s",
                whiteSpace: "nowrap",
              }}
            >
              <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
                <path d="M1 4h12M5 4V2h4v2M2 4l1 10h8l1-10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {deleteConfirm ? `确认删除 ${selectedIds.size} 项` : `删除用户${selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}`}
            </button>

            {deleteConfirm && (
              <button
                onClick={() => setDeleteConfirm(false)}
                style={{ height: "48px", padding: "0 16px", borderRadius: "28px", border: "1.5px solid rgba(203,161,115,0.5)", backgroundColor: "rgba(255,255,255,0.9)", cursor: "pointer", fontSize: "14px", color: "#7A5030" }}
              >
                取消
              </button>
            )}
          </div>
        </div>

        {/* 用户网格 */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {pageUsers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "100px 0", color: "#A07850", fontSize: "16px" }}>
              {searchText ? "未找到匹配的用户" : "暂无用户，请在首页创建"}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              {pageUsers.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  selected={selectedIds.has(user.id)}
                  onSelect={toggleSelect}
                  onClick={onSelectUser}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部：第X页 + 分页点 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "24px" }}>
          <span style={{ fontSize: "14px", color: "#7A5030", fontWeight: 500, minWidth: "90px" }}>
            第 <strong style={{ color: "#FF8400" }}>{safePage + 1}</strong> 页
          </span>
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <PageDots total={totalPages} current={safePage} onDotClick={setCurrentPage} />
          </div>
          <div style={{ minWidth: "90px" }} />
        </div>
      </main>

      {/* 左下角：设备状态 */}
      <div
        style={{
          position: "fixed",
          bottom: "30px",
          left: "48px",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 16px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.75)",
          border: "1px solid rgba(203,161,115,0.35)",
          fontSize: "13px",
          fontWeight: 600,
          color: deviceConnected ? "#5A8F5A" : "#B0765A",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: deviceConnected ? "#4caf50" : "#c98" }} />
        {deviceConnected ? "设备连接正常" : "设备未连接"}
      </div>

      {/* 右下角：返回首页 */}
      <div style={{ position: "fixed", bottom: "30px", right: "64px", zIndex: 50 }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 600, color: "#FF8400", padding: "8px 0", letterSpacing: "0.02em", textDecoration: "underline", textUnderlineOffset: "4px" }}
        >
          返回首页
        </button>
      </div>
    </div>
  );
}
