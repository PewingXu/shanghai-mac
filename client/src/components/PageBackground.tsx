/**
 * 全局页面背景 —— 与首页（landing）同款：暖白渐变 + 左右曲线沙漏装饰。
 * 用户管理 / 解决方案等页共用，保证全系统视觉风格一致（对齐设计稿）。
 */
export default function PageBackground() {
  return (
    <>
      {/* 背景渐变层（同 home-gradient-base） */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background:
            "linear-gradient(180deg, rgba(255, 219, 181, 0.86) 0%, rgba(255, 249, 237, 0.96) 48%, #eee7d4 100%), linear-gradient(180deg, #f3ebdd 0%, #eee7d4 100%)",
        }}
      />
      {/* 左侧曲线（同 home-hourglass-left） */}
      <img
        src="/assets/icons/home-page/hourglass-left.svg"
        alt=""
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-16.25vw",
          top: "-1.3vh",
          width: "31.56vw",
          maxWidth: "606px",
          height: "auto",
          opacity: 0.6,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 0,
        }}
      />
      {/* 右侧曲线（同 home-hourglass-right） */}
      <img
        src="/assets/icons/home-page/hourglass-right.svg"
        alt=""
        aria-hidden="true"
        style={{
          position: "fixed",
          right: "-6.4vw",
          top: "-43.2vh",
          width: "42.92vw",
          minWidth: "720px",
          height: "auto",
          transform: "rotate(180deg)",
          filter: "drop-shadow(0 6px 50px rgba(252, 236, 222, 0.16))",
          mixBlendMode: "multiply",
          pointerEvents: "none",
          userSelect: "none",
          zIndex: 0,
        }}
      />
    </>
  );
}
