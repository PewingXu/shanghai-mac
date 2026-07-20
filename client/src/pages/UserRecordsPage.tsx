/**
 * UserRecordsPage — 用户测量记录子页面（按设计稿）。
 * 暖白背景（同首页）+ 透明页眉；标题"{用户名} 测量记录" + 右上"开始测量"；
 * 白底用户信息卡（渐变头像块 / 黑字字段 / 编辑图标 / 右侧删除用户）；
 * 表头（测量时间 / 方案更新时间）+ 白底记录行（序号 / 时间 / 查看 / 行外垃圾桶）。
 */
import { useEffect, useState } from "react";
import { useApp, type MeasureAnalysis } from "@/contexts/AppContext";
import { apiGetRecordData } from "@/lib/backendApi";
import UserFormModal, { type UserFormData } from "@/components/UserFormModal";
import ConfirmModal from "@/components/ConfirmModal";
import PageBackground from "@/components/PageBackground";

interface UserRecordsPageProps {
  onBack: () => void;
  onStartMeasure: () => void;
  /** 点击某条记录：读回该次分析 → 报告页重新渲染那次的完整交互报告 */
  onOpenReport: () => void;
}

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

/** 鞋码展示："41" → "41码"；已带"码"或为空则原样/占位 */
function formatShoeSize(s?: string): string {
  if (!s?.trim()) return "—";
  const t = s.trim();
  return t.endsWith("码") ? t : `${t}码`;
}

/** 字段：标签(小/浅) + 值(大/深)，与用户管理卡片同款排版 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ fontSize: "14px", fontWeight: 300, color: "#8a8275", whiteSpace: "nowrap" }}>
      {label}
      <span style={{ fontSize: "18px", fontWeight: 500, color: "#17191C", marginLeft: "2px" }}>{value}</span>
    </span>
  );
}

export default function UserRecordsPage({ onBack, onStartMeasure, onOpenReport }: UserRecordsPageProps) {
  const {
    currentUser,
    collectionRecords,
    loadRecordsForUser,
    removeCollectionRecord,
    removeHistoryUsers,
    setSelectedRecord,
    setAnalysis,
    updateUser,
  } = useApp();
  const [loadingId, setLoadingId] = useState<number | null>(null);
  // 编辑用户资料弹窗（点用户信息卡内编辑图标打开）
  const [showEdit, setShowEdit] = useState(false);

  const handleEditSubmit = async (data: UserFormData) => {
    if (!currentUser) return;
    await updateUser({ ...currentUser, ...data, id: currentUser.id });
    setShowEdit(false);
  };

  // 进入页面：从后端拉取该用户的全部采集记录（今天/昨天/更早的都在，按时间倒序）
  useEffect(() => {
    if (currentUser) void loadRecordsForUser(currentUser.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const userRecords = collectionRecords.filter((r) => r.userId === currentUser?.id);
  const age = computeAge(currentUser?.birthDate);

  const handleRecordClick = async (record: (typeof collectionRecords)[0]) => {
    if (loadingId != null) return; // 防重入
    setLoadingId(record.id);
    try {
      const data = await apiGetRecordData<MeasureAnalysis>(record.id);
      setSelectedRecord(record);
      setAnalysis(data); // 报告页由这份历史分析重新渲染（3D/热力图/COP 全部可交互）
      onOpenReport();
    } catch (err) {
      console.warn("[record] 读取采集记录失败:", err);
      window.alert("读取该条记录失败，请确认后端服务在运行");
    } finally {
      setLoadingId(null);
    }
  };

  // 删除确认弹窗（设计稿样式）：删除用户 / 删除单条测量记录共用
  const [confirmAction, setConfirmAction] = useState<null | { type: "user" } | { type: "record"; id: number }>(null);

  const handleConfirmDelete = () => {
    if (!confirmAction) return;
    if (confirmAction.type === "user" && currentUser) {
      removeHistoryUsers([currentUser.id]); // 连同其全部采集记录
      setConfirmAction(null);
      onBack();
      return;
    }
    if (confirmAction.type === "record") {
      removeCollectionRecord(confirmAction.id);
    }
    setConfirmAction(null);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <PageBackground />

      {/* 透明页眉（设计稿：仅 Logo，浮于背景） */}
      <header style={{ padding: "22px 56px 10px", position: "relative", zIndex: 10 }}>
        <img src="/assets/icons/home-page/top-left-logo.svg" alt="ACIKI 动态足底压力解析系统" style={{ height: "48px" }} />
      </header>

      {/* 主内容 */}
      <main style={{ flex: 1, padding: "18px 120px 90px", position: "relative", zIndex: 1 }}>
        {/* 未选中用户（刷新/直达丢会话时）：引导回用户管理选择 */}
        {!currentUser && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "#B07840", fontSize: "15px" }}>
            <p style={{ marginBottom: "18px" }}>尚未选择用户，请先在用户管理中选择一位用户</p>
            <button
              onClick={onBack}
              style={{ background: "linear-gradient(90deg,#ff9a2e,#ff8400)", border: "none", borderRadius: "10px", padding: "10px 22px", cursor: "pointer", fontSize: "14px", fontWeight: 700, color: "#fff", boxShadow: "0 4px 12px rgba(255,132,0,0.3)" }}
            >
              去选择用户
            </button>
          </div>
        )}

        {currentUser && (
          <>
            {/* 标题行：{用户名} 测量记录 + 右侧开始测量 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "22px" }}>
              <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700, color: "#17191C" }}>
                {currentUser.name} 测量记录
              </h1>
              <button
                onClick={onStartMeasure}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  height: "42px",
                  padding: "0 22px",
                  borderRadius: "22px",
                  border: "1.5px solid #FFB25F",
                  background: "#ffffff",
                  cursor: "pointer",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#FF8400",
                }}
              >
                {/* 播放圆圈图标 */}
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="8" stroke="#FF8400" strokeWidth="1.6" />
                  <path d="M7.2 5.8L12 9L7.2 12.2V5.8Z" fill="#FF8400" />
                </svg>
                开始测量
              </button>
            </div>

            {/* 用户信息卡（设计稿：白底橙细边 + 渐变头像块 + 黑字字段 + 编辑 + 右侧删除用户） */}
            <div
              style={{
                display: "flex",
                alignItems: "stretch",
                borderRadius: "12px",
                overflow: "hidden",
                background: "linear-gradient(201deg, #fff5e3 6%, #ffffff 38%)",
                border: "1px solid #FFCB7D",
                boxShadow: "0 2px 6px rgba(232,202,169,0.6)",
                marginBottom: "24px",
                minHeight: "76px",
              }}
            >
              {/* 渐变头像块（同用户管理卡片） */}
              <div
                style={{
                  width: "78px",
                  flexShrink: 0,
                  background: "linear-gradient(194deg, rgba(255,225,165,0.7) -14%, rgba(255,151,39,0.7) 64%, rgba(255,242,206,0.56) 99%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <img src="/assets/icons/history-user-page/user-avatar.svg" alt="" style={{ width: "32px", height: "auto" }} />
              </div>

              {/* 字段区（黑字，同设计稿；补充身高/体重，编辑后即时可见） */}
              <div style={{ flex: 1, minWidth: 0, padding: "0 26px", display: "flex", alignItems: "center", gap: "36px" }}>
                <span style={{ fontSize: "18px", fontWeight: 700, color: "#17191C", whiteSpace: "nowrap" }}>
                  用户：{currentUser.name}
                </span>
                <Field label="性别：" value={currentUser.gender || "—"} />
                <Field label="鞋码：" value={formatShoeSize(currentUser.shoeSize)} />
                <Field label="年龄：" value={age != null ? `${age}岁` : "—"} />
                <Field label="身高：" value={currentUser.height != null ? `${currentUser.height}cm` : "—"} />
                <Field label="体重：" value={currentUser.weight != null ? `${currentUser.weight}kg` : "—"} />
                {/* 编辑图标（橙色原色，点击弹编辑资料弹窗） */}
                <button
                  onClick={() => setShowEdit(true)}
                  title="编辑资料"
                  style={{ border: "none", background: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", transition: "transform 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <img src="/assets/icons/history-user-page/edit.svg" alt="" style={{ width: "18px", height: "18px" }} />
                </button>
              </div>

              {/* 右侧：删除用户 */}
              <button
                onClick={() => setConfirmAction({ type: "user" })}
                style={{ border: "none", background: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px", padding: "0 26px", fontSize: "15px", fontWeight: 600, color: "#FF8400", whiteSpace: "nowrap" }}
              >
                删除用户
                <img src="/assets/icons/history-user-page/delete.svg" alt="" style={{ width: "17px", height: "17px" }} />
              </button>
            </div>

            {/* 表头条（设计稿：橙色浅底圆角，测量时间 / 方案更新时间） */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: "48px",
                borderRadius: "10px",
                background: "linear-gradient(90deg, #FACD96 0%, #F8C88C 100%)",
                marginBottom: "14px",
                fontSize: "16px",
                fontWeight: 700,
                color: "#17191C",
              }}
            >
              <span style={{ width: "96px" }} />
              <span style={{ width: "300px" }}>测量时间</span>
              <span style={{ flex: 1 }}>方案更新时间</span>
            </div>

            {/* 记录列表 */}
            {userRecords.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#B07840", fontSize: "15px" }}>
                暂无测量记录，点击右上角「开始测量」进行第一次测量
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {userRecords.map((record, index) => (
                  <div key={record.id} style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                    {/* 记录行卡片（设计稿：白底 72 高 / 2px #F6CDA1 边 / 圆角 10 / 阴影） */}
                    <div
                      onClick={() => handleRecordClick(record)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        height: "64px",
                        display: "flex",
                        alignItems: "center",
                        borderRadius: "10px",
                        background: "#ffffff",
                        border: "2px solid #F6CDA1",
                        boxShadow: "0 2px 6px rgba(249,222,194,0.4)",
                        cursor: "pointer",
                        transition: "all 0.18s cubic-bezier(0.23,1,0.32,1)",
                        boxSizing: "border-box",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = "0 4px 14px rgba(249,222,194,0.9)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = "0 2px 6px rgba(249,222,194,0.4)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }}
                    >
                      {/* 序号（橙色） */}
                      <span style={{ width: "96px", textAlign: "center", fontSize: "18px", fontWeight: 700, color: "#FF8400" }}>
                        {index + 1}
                      </span>
                      {/* 测量时间（黑） */}
                      <span style={{ width: "300px", fontSize: "18px", fontWeight: 500, color: "#17191C", whiteSpace: "nowrap" }}>
                        {record.date}&nbsp;&nbsp;{record.time}
                      </span>
                      {/* 方案更新时间（灰蓝 #6C7784；暂无方案编辑数据 → 占位） */}
                      <span style={{ flex: 1, fontSize: "18px", fontWeight: 400, color: "#6C7784", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        —
                      </span>
                      {/* 查看 + 橙色箭头 */}
                      <span style={{ display: "flex", alignItems: "center", gap: "10px", paddingRight: "26px", fontSize: "16px", fontWeight: 600, color: "#FF8400", flexShrink: 0 }}>
                        {loadingId === record.id ? "读取中…" : "查看"}
                        <svg width="10" height="20" viewBox="0 0 10 20" fill="none">
                          <path d="M2 3L8 10L2 17" stroke="#FF8400" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </div>

                    {/* 行外右侧：删除该条记录（设计稿垃圾桶在行卡片外） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmAction({ type: "record", id: record.id });
                      }}
                      title="删除记录"
                      style={{ border: "none", background: "none", cursor: "pointer", padding: "6px", display: "flex", alignItems: "center", borderRadius: "6px", transition: "transform 0.15s", flexShrink: 0 }}
                      onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.15)")}
                      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                    >
                      <img src="/assets/icons/history-user-page/delete.svg" alt="" style={{ width: "18px", height: "18px" }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* 返回上一页（右下角） */}
      <div style={{ position: "fixed", bottom: "28px", right: "56px", zIndex: 20 }}>
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "600",
            color: "#FF8400",
            textDecoration: "underline",
            textUnderlineOffset: "4px",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          返回上一页
        </button>
      </div>

      {/* 编辑用户资料弹窗（与创建用户同款设计，字段预填，确认修改持久化） */}
      {showEdit && currentUser && (
        <UserFormModal
          mode="edit"
          initial={currentUser}
          onSubmit={(d) => void handleEditSubmit(d)}
          onCancel={() => setShowEdit(false)}
        />
      )}

      {/* 删除确认弹窗（设计稿样式）：删除用户 / 删除单条记录 */}
      {confirmAction?.type === "user" && (
        <ConfirmModal
          title="删除用户"
          message={"删除该用户后，其所有数据将被一并清除。\n确认删除吗？"}
          confirmText="删除用户"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction?.type === "record" && (
        <ConfirmModal
          title="删除记录"
          message="确认删除此项测量记录？"
          confirmText="确认删除"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
