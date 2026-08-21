import React, { useState, useMemo, useEffect } from "react";
import { formatUserId, maskPhone, userMatchesQuery } from "@/lib/utils";
import ConfirmModal from "@/components/ConfirmModal";
import { useApp, User } from "@/contexts/AppContext";
import PageBackground from "@/components/PageBackground";

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
        width: "95px", // 设计稿：95×132 头像块
        flexShrink: 0,
        alignSelf: "stretch",
        // 设计稿：194deg 暖橙渐变
        background: "linear-gradient(194deg, rgba(255,225,165,0.7) -14%, rgba(255,151,39,0.7) 64%, rgba(255,242,206,0.56) 99%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <img src="/assets/icons/history-user-page/user-avatar.svg" alt="" style={{ width: "38px", height: "auto" }} />
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
        minHeight: "132px", // 设计稿：550×132；窄屏字段换行时允许卡片撑高，不裁内容
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

      <div style={{ flex: 1, minWidth: 0, padding: "0 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "14px" }}>
        {/* 姓名 + 唯一 ID（设计稿：同为深黑，ID 略小） */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
          <span style={{ fontSize: "20px", fontWeight: 600, color: "#17191C", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {user.name}
          </span>
          <span style={{ fontSize: "15px", fontWeight: 500, color: "#17191C", whiteSpace: "nowrap", flexShrink: 0 }}>
            （ID:{formatUserId(user.id)}）
          </span>
          {user.phone && (
            <span style={{ fontSize: "14px", fontWeight: 500, color: "#8a8275", whiteSpace: "nowrap", flexShrink: 0 }}>
              {maskPhone(user.phone)}
            </span>
          )}
        </div>
        {/* 性别 / 鞋码 / 年龄（设计稿：整行浅橙底衬条；窄屏收紧间距减少换行） */}
        <div style={{ display: "flex", columnGap: "clamp(12px, 1.2vw, 24px)", rowGap: "4px", alignItems: "baseline", flexWrap: "wrap", background: "#FFF6E9", borderRadius: "6px", padding: "5px 12px", width: "fit-content" }}>
          <Field label="性别：" value={user.gender || "—"} />
          <Field label="鞋码：" value={user.shoeSize?.trim() ? (user.shoeSize.trim().endsWith("码") ? user.shoeSize.trim() : `${user.shoeSize.trim()}码`) : "—"} />
          <Field label="年龄：" value={age != null ? `${age}岁` : "—"} />
        </div>
      </div>

      {/* 右箭头（设计稿：12×24 橙色 #FF8400） */}
      <div style={{ display: "flex", alignItems: "center", paddingRight: "18px", flexShrink: 0 }}>
        <svg width="12" height="24" viewBox="0 0 12 24" fill="none" style={{ opacity: hovered ? 1 : 0.8, transform: hovered ? "translateX(2px)" : "none", transition: "all 0.15s" }}>
          <path d="M2 3L10 12L2 21" stroke="#FF8400" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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

// ─── 分页点（滑动窗口）──────────────────────────────────────────────────────
// 页数再多也最多显示 10 个点。点击窗口最后一个点时，该页滑到窗口第 7 位
// （后面再露 3 页）；点击窗口第一个点时对称地滑到第 4 位——到头则不再滑。
const DOT_WINDOW = 10;

function PageDots({ total, current, onDotClick }: { total: number; current: number; onDotClick: (page: number) => void }) {
  const [start, setStart] = useState(0);

  // 外部翻页/搜索重置/总页数变化时，保证当前页始终在窗口内
  useEffect(() => {
    setStart((s) => {
      const maxStart = Math.max(0, total - DOT_WINDOW);
      if (current < s) return Math.max(0, Math.min(current - 3, maxStart));
      if (current > s + DOT_WINDOW - 1) return Math.max(0, Math.min(current - 6, maxStart));
      return Math.min(s, maxStart);
    });
  }, [current, total]);

  const end = Math.min(total, start + DOT_WINDOW);
  const maxStart = Math.max(0, total - DOT_WINDOW);

  const handleClick = (p: number) => {
    onDotClick(p);
    if (p === end - 1 && end < total) {
      setStart(Math.max(0, Math.min(p - 6, maxStart))); // 该页滑到第 7 位，后面露 3 页
    } else if (p === start && start > 0) {
      setStart(Math.max(0, p - 3)); // 对称：滑到第 4 位，前面露 3 页
    }
  };

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      {start > 0 && <span style={{ fontSize: "12px", color: "rgba(255,132,0,0.5)", lineHeight: 1 }}>…</span>}
      {Array.from({ length: end - start }).map((_, k) => {
        const i = start + k;
        return (
          <button
            key={i}
            onClick={() => handleClick(i)}
            title={`第 ${i + 1} 页`}
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
        );
      })}
      {end < total && <span style={{ fontSize: "12px", color: "rgba(255,132,0,0.5)", lineHeight: 1 }}>…</span>}
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

  // 搜索维度：姓名 / ID / 手机号片段（尾号四位重复时全部列出）
  const filtered = useMemo(
    () => historyUsers.filter((u) => userMatchesQuery(u, searchText)),
    [historyUsers, searchText],
  );

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
    setDeleteConfirm(true); // 弹出设计稿确认弹窗
  };

  const confirmDelete = () => {
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
        // 不能 overflow:hidden——小屏下卡片网格降为 2 列变高，裁掉溢出会让
        // 固定定位的分页条压在卡片上（错位）。允许纵向滚动，横向由布局自适应。
        overflowX: "hidden",
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <PageBackground />
      {/* 页眉：用户管理页不展示步骤条导航，仅保留 Logo（同测量记录页） */}
      <header style={{ padding: "22px 56px 0", position: "relative", zIndex: 10 }}>
        <img src="/assets/icons/home-page/top-left-logo.svg" alt="ACIKI 动态足底压力解析系统" style={{ height: "48px" }} />
      </header>

      <main
        style={{
          position: "relative",
          zIndex: 10,
          // 底部留出分页条(bottom 100)+设备徽章(bottom 30)的空间：
          // 小屏滚动到底时最后一行卡片不被固定元素盖住
          padding: "20px 64px 170px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 标题行 + 右侧搜索/删除 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "26px" }}>
          <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, color: "#3D2000", letterSpacing: "0.04em" }}>用户管理</h1>

          <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
            {/* 搜索框（设计稿：白底橙细边胶囊，右侧"查询"为橙色文字） */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#ffffff",
                borderRadius: "22px",
                border: "1.5px solid #FFB25F",
                padding: "0 18px",
                height: "42px",
                gap: "10px",
                width: "300px",
                boxSizing: "border-box",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="6.5" cy="6.5" r="5" stroke="#F08614" strokeWidth="1.6" />
                <path d="M10.5 10.5L14 14" stroke="#F08614" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={searchText}
                onChange={handleSearch}
                placeholder="搜索姓名 / ID / 手机尾号"
                style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontSize: "14px", color: "#3D2000" }}
              />
              <button
                onClick={() => setCurrentPage(0)}
                style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", fontSize: "15px", fontWeight: 600, color: "#FF8400", padding: 0 }}
              >
                查询
              </button>
            </div>

            {/* 删除用户（设计稿：白底橙字橙细边胶囊；点击弹确认弹窗） */}
            <button
              onClick={handleDelete}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                height: "42px",
                padding: "0 20px",
                borderRadius: "22px",
                border: "1.5px solid #FFB25F",
                backgroundColor: "#ffffff",
                cursor: selectedIds.size > 0 ? "pointer" : "not-allowed",
                opacity: selectedIds.size > 0 ? 1 : 0.6,
                fontSize: "15px",
                fontWeight: 600,
                color: "#FF8400",
                transition: "all 0.18s",
                whiteSpace: "nowrap",
              }}
            >
              {/* 删除图标（mask 方式跟随文字颜色：常态棕、确认删除态红） */}
              <span
                style={{
                  width: "16px",
                  height: "16px",
                  display: "inline-block",
                  backgroundColor: "currentcolor",
                  WebkitMaskImage: "url(/assets/icons/history-user-page/delete.svg)",
                  maskImage: "url(/assets/icons/history-user-page/delete.svg)",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                }}
              />
              删除用户{selectedIds.size > 0 ? `（${selectedIds.size}）` : ""}
            </button>
          </div>
        </div>

        {/* 用户网格 */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {pageUsers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "100px 0", color: "#A07850", fontSize: "16px" }}>
              {searchText ? "未找到匹配的用户" : "暂无用户，请在首页创建"}
            </div>
          ) : (
            // 列数随屏宽自适应（卡片最窄 460px）：小屏自动降为 2 列/1 列，不再压瘪卡片错位
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(460px, 1fr))", gap: "20px" }}>
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

      </main>

      {/* 底部分页线（固定位置，不随卡片数量浮动；在设备徽章那条线上方）：
          "第 N 页"贴左与卡片列对齐（设计稿位置），分页点独立居中 */}
      <span
        style={{
          position: "fixed",
          bottom: "128px",
          left: "64px",
          zIndex: 20,
          fontSize: "14px",
          color: "#7A5030",
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        第 <strong style={{ color: "#FF8400" }}>{safePage + 1}</strong> / {totalPages} 页
      </span>
      <div
        style={{
          position: "fixed",
          bottom: "128px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
        }}
      >
        <PageDots total={totalPages} current={safePage} onDotClick={setCurrentPage} />
      </div>

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

      {/* 删除用户确认弹窗（设计稿样式） */}
      {deleteConfirm && (
        <ConfirmModal
          title="删除用户"
          message={`删除${selectedIds.size > 1 ? `这 ${selectedIds.size} 位` : "该"}用户后，其所有数据将被一并清除。\n确认删除吗？`}
          confirmText="删除用户"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}

      {/* 右下角：返回上一页（回到进入本页前的页面：首页/采集页等） */}
      <div style={{ position: "fixed", bottom: "30px", right: "64px", zIndex: 50 }}>
        <button
          onClick={onBack}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", fontWeight: 600, color: "#FF8400", padding: "8px 0", letterSpacing: "0.02em", textDecoration: "underline", textUnderlineOffset: "4px" }}
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
