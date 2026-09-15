/**
 * 矩侨工业品牌标识：蓝底白纹图标 + 「矩侨工业」字标。
 * 全系统页眉统一用它（首页 / 顶栏 / 用户管理 / 测量记录 / 方案页）。
 */
export const BRAND_LOGO_URL = "/assets/brand/juqiao-logo.png";
export const BRAND_NAME = "矩侨工业";

interface BrandLogoProps {
  /** 图标边长（px），字标随之等比缩放 */
  size?: number;
  /** 只显示图标，不显示字标 */
  iconOnly?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function BrandLogo({ size = 48, iconOnly = false, style, className }: BrandLogoProps) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.28), ...style }}
    >
      <img
        src={BRAND_LOGO_URL}
        alt={BRAND_NAME}
        style={{ width: size, height: size, objectFit: "contain", display: "block", flexShrink: 0 }}
      />
      {!iconOnly && (
        <span
          style={{
            fontSize: Math.round(size * 0.5),
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: "#00359B",
            whiteSpace: "nowrap",
            lineHeight: 1,
            fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
          }}
        >
          {BRAND_NAME}
        </span>
      )}
    </div>
  );
}
