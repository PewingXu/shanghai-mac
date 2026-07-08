/**
 * 全局异常弹窗（设备连接三种失败情况）。
 * - 优先级最高：固定全屏遮罩，z-index 极高，盖在页脚等之上。
 * - 通过 window 事件 "aciki-exception" 触发；由 Home 顶层监听并渲染（首页不弹）。
 * - 用 HTML/CSS 复刻设计稿，「我知道了」/× 可点击关闭。
 */

export type ExceptionType = "disconnected" | "port-busy" | "port-error";

const EXCEPTIONS: Record<ExceptionType, { title: string; message: string }> = {
  disconnected: {
    title: "未连接",
    message: "未检测到设备，请检查设备是否连接或驱动是否正常？",
  },
  "port-busy": {
    title: "端口占用",
    message: "端口被占用，请关闭其他正在使用该设备的软件",
  },
  "port-error": {
    title: "连接异常",
    message: "端口异常，请重新插拔设备后重试",
  },
};

/** 触发全局异常弹窗（任意页面可调用） */
export function broadcastException(type: ExceptionType) {
  window.dispatchEvent(new CustomEvent("aciki-exception", { detail: { type } }));
}

/** 把 Web Serial 的报错归类到三种弹窗之一 */
export function classifySerialError(err: unknown): ExceptionType {
  const e = err as { name?: string; message?: string } | undefined;
  const name = e?.name ?? "";
  const msg = String(e?.message ?? err ?? "").toLowerCase();
  // 用户取消选择 / 没有可用设备
  if (name === "NotFoundError" || name === "AbortError" || msg.includes("no port") || msg.includes("no device")) {
    return "disconnected";
  }
  // 端口被占用 / 已被打开 / 打开失败（多为其它软件占用）
  if (
    name === "InvalidStateError" ||
    name === "NetworkError" ||
    msg.includes("already open") ||
    msg.includes("in use") ||
    msg.includes("failed to open") ||
    msg.includes("access")
  ) {
    return "port-busy";
  }
  return "port-error";
}

export default function ExceptionModal({
  type,
  onClose,
}: {
  type: ExceptionType | null;
  onClose: () => void;
}) {
  if (!type) return null;
  const info = EXCEPTIONS[type];

  return (
    <div className="aciki-exc-overlay" onClick={onClose}>
      <div
        className="aciki-exc-card"
        role="alertdialog"
        aria-label={info.title}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="aciki-exc-close" type="button" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <div className="aciki-exc-title">
          <span className="aciki-exc-icon" aria-hidden="true">
            !
          </span>
          {info.title}
        </div>
        <p className="aciki-exc-msg">{info.message}</p>
        <button className="aciki-exc-ok" type="button" onClick={onClose}>
          我知道了
        </button>
      </div>

      <style>{`
        .aciki-exc-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(60, 40, 20, 0.18);
          backdrop-filter: blur(1px);
          animation: aciki-exc-fade 160ms ease-out;
        }
        .aciki-exc-card {
          position: relative;
          width: min(480px, calc(100vw - 48px));
          box-sizing: border-box;
          padding: 28px 30px 26px;
          border-radius: 16px;
          background: linear-gradient(180deg, #fff3e2 0%, #fde6cf 100%);
          border: 1px solid #f6c98a;
          box-shadow: 0 20px 60px rgba(180, 120, 50, 0.28);
          font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
          animation: aciki-exc-pop 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
        .aciki-exc-close {
          position: absolute;
          top: 18px;
          right: 20px;
          border: 0;
          background: transparent;
          color: #9a8a76;
          font-size: 24px;
          line-height: 1;
          cursor: pointer;
          padding: 2px 6px;
          transition: color 150ms ease;
        }
        .aciki-exc-close:hover { color: #5a4a36; }
        .aciki-exc-title {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #ff5a2c;
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 2px;
        }
        .aciki-exc-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border: 2px solid #ff5a2c;
          border-radius: 50%;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0;
        }
        .aciki-exc-msg {
          margin: 26px 0 0;
          color: #3a352e;
          font-size: 18px;
          font-weight: 700;
          line-height: 1.7;
        }
        .aciki-exc-ok {
          display: block;
          margin: 34px 0 0 auto;
          border: 0;
          background: transparent;
          color: #ff8400;
          font-size: 18px;
          font-weight: 700;
          text-decoration: underline;
          text-underline-offset: 5px;
          cursor: pointer;
          padding: 0;
        }
        .aciki-exc-ok:active { transform: scale(0.97); }
        @keyframes aciki-exc-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes aciki-exc-pop {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
