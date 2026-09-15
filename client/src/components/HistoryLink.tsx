/**
 * 「体验记录」入口：右上角常驻的下划线文字链接（首页 / 采集 / 报告 / 方案页同一枚）。
 * 样式与首页 landing 的 .home-user-link 一致，这里内联是为了不依赖各页各自的 <style> 块。
 */
export default function HistoryLink({ onClick, className }: { onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label="体验记录"
      style={{
        padding: 0,
        border: 0,
        background: "transparent",
        fontSize: "clamp(15px, 0.94vw, 18px)",
        fontWeight: 700,
        color: "#0a3997",
        textDecoration: "underline",
        textUnderlineOffset: "5px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "opacity 160ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
    >
      体验记录
    </button>
  );
}
