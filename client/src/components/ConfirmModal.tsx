/**
 * ConfirmModal — 删除确认弹窗（设计稿：634px 暖橙渐变卡 / #8C929E 80% 遮罩 /
 * 右上 × / 底部"取消 | 确认"双文字按钮带竖分隔线）。
 * 用于删除用户 / 删除测量记录等危险操作确认，替代 window.confirm。
 */
export default function ConfirmModal({
  title,
  message,
  confirmText = "确认删除",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="confirm-modal-overlay">
      <div className="confirm-modal-card">
        <div className="confirm-modal-head">
          <h2>{title}</h2>
          <button type="button" className="confirm-modal-close" onClick={onCancel} aria-label="关闭">
            ×
          </button>
        </div>

        <p className="confirm-modal-message">{message}</p>

        <div className="confirm-modal-actions">
          <button type="button" className="confirm-modal-cancel" onClick={onCancel}>
            取消
          </button>
          <span className="confirm-modal-divider" />
          <button type="button" className="confirm-modal-confirm" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>

        <style>{styles}</style>
      </div>
    </div>
  );
}

const styles = `
  .confirm-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(140,146,158,0.8);
    animation: confirm-modal-fade 160ms ease-out;
  }

  /* 设计稿精确标注：卡片 634×356 / 圆角 16 / 1.5px #0A3997 边 / 内容左缘 47px；
     纵向布局闭合：40(顶) + 34(标题) + 50(隔) + 80(正文) + 66(隔) + 86(按钮区) = 356 */
  .confirm-modal-card {
    width: min(634px, calc(100vw - 48px));
    border-radius: 16px;
    background: linear-gradient(180deg, #e5eeff 69%, #f1f6ff 99%);
    border: 1.5px solid #0A3997;
    box-shadow: 0 4px 6px #8897b5;
    box-sizing: border-box;
    padding: 40px 47px 0;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
    animation: confirm-modal-pop 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }

  .confirm-modal-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 34px; /* 设计稿标题行高 */
  }

  /* 标题（设计稿 111×34 反推）：24px 加粗 + 0.2em 字距 */
  .confirm-modal-head h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.2em;
    color: #17191c;
  }

  .confirm-modal-close {
    border: 0;
    background: transparent;
    font-size: 26px;
    line-height: 1;
    font-weight: 300;
    color: #929292;
    cursor: pointer;
    margin-right: -17px; /* 设计稿 × 离右缘 30px（内边距 47 − 17） */
  }

  /* 正文（设计稿标注 PingFang SC 24px/500 = 苹方 Medium）：Windows 雅黑无 500 档
     会回退成 400 显得偏细，用 600 出加粗观感（与设计稿 SVG 的笔画粗细一致） */
  .confirm-modal-message {
    margin: 50px 0 0; /* 设计稿：正文 top 124 − 标题区(40+34) */
    min-height: 80px;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.1em;
    line-height: 40px;
    color: #000000;
    white-space: pre-line;
  }

  /* 按钮区：顶部细分隔线（留在内边距内，不到卡片边缘）+ 中间短竖线 */
  .confirm-modal-actions {
    display: flex;
    align-items: stretch;
    border-top: 1px solid rgba(130,153,200,0.55);
    margin-top: 66px; /* 设计稿：正文底(204) → 分隔线(270) */
    height: 86px;     /* 设计稿：分隔线(270) → 卡底(356) */
  }

  /* 按钮（设计稿 96×34 反推：24px；与正文同样加粗） */
  .confirm-modal-actions button {
    flex: 1;
    border: 0;
    background: transparent;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.05em;
    cursor: pointer;
  }

  .confirm-modal-cancel {
    color: #9e9e9e;
  }

  .confirm-modal-confirm {
    color: #0A3997;
  }

  .confirm-modal-divider {
    width: 1px;
    align-self: center;
    height: 56%;
    background: rgba(130,153,200,0.55);
  }

  @keyframes confirm-modal-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes confirm-modal-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
`;
