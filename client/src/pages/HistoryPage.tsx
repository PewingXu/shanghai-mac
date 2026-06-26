import React, { useState, useMemo } from "react";
import { useApp, User } from "@/contexts/AppContext";
import PageBackground from "@/components/PageBackground";
import TopNavBar from "@/components/TopNavBar";

const PAGE_SIZE = 12; // 每页显示 12 个（3列×4行）

// ─── 用户头像图标（内联 SVG，橙色渐变背景） ──────────────────────────────────
function UserAvatar() {
  return (
    <div
      style={{
        width: "68px",
        height: "68px",
        borderRadius: "12px",
        background: "linear-gradient(135deg, #F5B96E 0%, #E8944A 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="18" cy="13" r="7" fill="rgba(255,255,255,0.9)" />
        <path
          d="M4 32c0-7.732 6.268-14 14-14s14 6.268 14 14"
          stroke="rgba(255,255,255,0.9)"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ─── 用户卡片 ─────────────────────────────────────────────────────────────────
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

  const birthFormatted = user.birthDate
    ? user.birthDate.replace(/-/g, ".").slice(0, 10)
    : "—";

  return (
    <div
      onClick={() => onClick(user)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        backgroundColor: selected
          ? "rgba(232, 148, 74, 0.15)"
          : hovered
          ? "rgba(255, 255, 255, 0.9)"
          : "rgba(255, 255, 255, 0.75)",
        borderRadius: "14px",
        padding: "16px 20px",
        cursor: "pointer",
        border: selected
          ? "1.5px solid rgba(232, 148, 74, 0.6)"
          : "1.5px solid transparent",
        boxShadow: hovered
          ? "0 4px 16px rgba(180, 100, 20, 0.12)"
          : "0 2px 8px rgba(180, 100, 20, 0.06)",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        transition: "all 0.18s cubic-bezier(0.23, 1, 0.32, 1)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 左侧选择框（仅在 hover 或 selected 时显示） */}
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
          border: selected
            ? "2px solid #E8944A"
            : "2px solid rgba(200, 160, 100, 0.5)",
          backgroundColor: selected ? "#E8944A" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: hovered || selected ? 1 : 0,
          transition: "all 0.15s",
          flexShrink: 0,
          zIndex: 2,
        }}
      >
        {selected && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      <UserAvatar />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "18px",
            fontWeight: "600",
            color: "#3D2000",
            marginBottom: "6px",
            letterSpacing: "0.02em",
          }}
        >
          {user.name}
        </div>
        <div
          style={{
            fontSize: "13px",
            color: "#7A5030",
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <span>性别：{user.gender || "—"}</span>
          <span>体重：{user.weight ? `${user.weight}kg` : "—"}</span>
          <span>生日：{birthFormatted}</span>
        </div>
      </div>

      {/* 右箭头 */}
      <svg
        width="10"
        height="16"
        viewBox="0 0 10 16"
        fill="none"
        style={{
          flexShrink: 0,
          opacity: hovered ? 1 : 0.5,
          transition: "opacity 0.15s, transform 0.15s",
          transform: hovered ? "translateX(2px)" : "translateX(0)",
        }}
      >
        <path
          d="M1 1L9 8L1 15"
          stroke="#E8944A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ─── 分页点 ───────────────────────────────────────────────────────────────────
function PageDots({
  total,
  current,
  onDotClick,
}: {
  total: number;
  current: number;
  onDotClick: (page: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onDotClick(i)}
          style={{
            width: i === current ? "20px" : "10px",
            height: "10px",
            borderRadius: "5px",
            backgroundColor: i === current ? "#E8944A" : "rgba(232, 148, 74, 0.35)",
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

// ─── 历史用户页面主体 ─────────────────────────────────────────────────────────
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

  // 过滤
  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return historyUsers;
    return historyUsers.filter((u) => u.name.toLowerCase().includes(q));
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
        fontFamily:
          '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <PageBackground />
      <TopNavBar currentStep={0} showHistory={false} />

      <main
        style={{
          position: "relative",
          zIndex: 10,
          paddingTop: "108px",
          paddingBottom: "80px",
          paddingLeft: "64px",
          paddingRight: "64px",
          minHeight: "100vh",
        }}
      >
        {/* 标题行 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "28px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "26px",
              fontWeight: "700",
              color: "#3D2000",
              letterSpacing: "0.04em",
            }}
          >
            历史用户
          </h1>

          {/* 右侧：搜索框 + 删除按钮 */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              alignItems: "center",
              justifyContent: "flex-end",
              marginLeft: "auto",
              minWidth: 0,
            }}
          >
            {/* 搜索框 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "rgba(255, 255, 255, 0.85)",
                borderRadius: "24px",
                border: "1.5px solid rgba(203, 161, 115, 0.4)",
                padding: "0 22px",
                height: "54px",
                gap: "10px",
                width: "360px",
                minWidth: "260px",
                boxSizing: "border-box",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{ flexShrink: 0, opacity: 0.5 }}
              >
                <circle
                  cx="6.5"
                  cy="6.5"
                  r="5"
                  stroke="#7A5030"
                  strokeWidth="1.5"
                />
                <path
                  d="M10.5 10.5L14 14"
                  stroke="#7A5030"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={handleSearch}
                placeholder="搜索用户"
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  fontSize: "14px",
                  color: "#3D2000",
                }}
              />
            </div>

            <button
              onClick={() => {/* 搜索已实时生效 */}}
              style={{
                height: "54px",
                padding: "0 8px",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: "700",
                color: "#E8944A",
                flexShrink: 0,
              }}
            >
              查询
            </button>

            {/* 删除按钮 */}
            <button
              onClick={handleDelete}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                height: "54px",
                padding: "0 26px",
                borderRadius: "28px",
                border: deleteConfirm
                  ? "1.5px solid #E05030"
                  : "1.5px solid rgba(203, 161, 115, 0.5)",
                backgroundColor: deleteConfirm
                  ? "rgba(224, 80, 48, 0.1)"
                  : "rgba(255, 255, 255, 0.85)",
                cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                opacity: selectedIds.size > 0 ? 1 : 0.5,
                fontSize: "14px",
                fontWeight: "600",
                color: deleteConfirm ? "#E05030" : "#7A5030",
                transition: "all 0.18s",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              <svg
                width="14"
                height="16"
                viewBox="0 0 14 16"
                fill="none"
              >
                <path
                  d="M1 4h12M5 4V2h4v2M2 4l1 10h8l1-10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {deleteConfirm
                ? `确认删除 ${selectedIds.size} 项`
                : `删除${selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}`}
            </button>

            {deleteConfirm && (
              <button
                onClick={() => setDeleteConfirm(false)}
                style={{
                  height: "54px",
                  padding: "0 16px",
                  borderRadius: "28px",
                  border: "1.5px solid rgba(203, 161, 115, 0.5)",
                  backgroundColor: "rgba(255, 255, 255, 0.85)",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "#7A5030",
                }}
              >
                取消
              </button>
            )}
          </div>
        </div>

        {/* 用户网格 */}
        {pageUsers.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "80px 0",
              color: "#A07850",
              fontSize: "16px",
            }}
          >
            {searchText ? "未找到匹配的用户" : "暂无历史用户记录"}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px",
              marginBottom: "40px",
            }}
          >
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

        {/* 底部：第X页 + 分页点 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "8px",
          }}
        >
          <span
            style={{
              fontSize: "14px",
              color: "#7A5030",
              fontWeight: "500",
              minWidth: "80px",
            }}
          >
            第 <strong>{safePage + 1}</strong> 页
          </span>

          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <PageDots
              total={totalPages}
              current={safePage}
              onDotClick={setCurrentPage}
            />
          </div>

          <div style={{ minWidth: "80px" }} />
        </div>
      </main>

      {/* 返回上一页（右下角） */}
      <div
        style={{
          position: "fixed",
          bottom: "32px",
          right: "64px",
          zIndex: 50,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "600",
            color: "#E8944A",
            padding: "8px 0",
            letterSpacing: "0.02em",
            transition: "color 0.15s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#C8682A";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateX(-3px)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "#E8944A";
            (e.currentTarget as HTMLButtonElement).style.transform =
              "translateX(0)";
          }}
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
