/**
 * 「对比前后」全屏对比态的平面覆盖层：两张标注卡 + 引线 + 竖排色标。
 *
 * 几何全部照设计稿 参考项目 aciki-plantar-pressure 的定制对比稿 量取（稿子是 1926×1080、顶栏 72px，
 * 下面注释里的「稿 y」是稿上的绝对 y，代码里的常量已减去 72、换成相对画布宿主的坐标）。
 * 稿子里没有一个 <text> 节点、文字全是路径，所以数值、色标刻度只能重新写；
 * 卡里那张剖面小图是从稿子内嵌的 4096×2499 PNG 里按 <pattern> 变换反算出来的切图
 * （assets/compare/section-*.webp），不是实时 3D 小窗 —— 实时小窗要么再开一个 WebGL
 * 上下文、要么把几百万面的几何体再克隆一份，代价与收益完全不成比例。
 *
 * 分工（关键，别合并）：
 *   卡片 / 色标 —— 位置钉死，只随「方案数值」和【缩放/平移】变（旋转一整圈都不动）
 *   引线       —— 随 3D 旋转每帧重新路由（走 imperative update()，直接改 SVG 属性）
 * 用户明确要的就是这个行为：「在旋转 3D 鞋垫的时候，小框框定住不动，只改变线条的长度」。
 * 所以引线**不能**走 state —— 这页 2200 行，60fps setState 会把整页重渲染。
 *
 * 「不许挡、不许横跨」两条约束怎么落地（用户原话：框框不能遮挡住 3D 鞋垫、
 * 连接的线不能横跨 3D 鞋垫，可以是折线，折角要 90°）：
 *   引线 —— 交给 lib/leaderRoute 路由成【竖一段 + 横一段】、恰好一个 90° 折角的 L 形。
 *           落点在卡片近边上的高度由路由挑（挑压在垫子上最短的那个），卡片本身不动。
 *           ⚠ 只折一次就没法绕开鞋垫了：横段必须从锚点一路切到屏幕边上，
 *             穿过多少垫子由机位决定。这是用户点名要的取舍，细节见 leaderRoute 头注释。
 *   卡片 —— 页边距按模型的【旋转不变横向包络】（InsoleProjection.rest*）往里让：
 *           那条界是「相机转任意方位角、任意仰角，模型都不会越过」的紧界，与当前朝向无关
 *           ⇒ 用户要的「转 360° 都不压到两侧的框」和「转的时候框不动」同时成立。
 *           窗口够宽就停在设计稿的 134/133，窗口一窄就把卡片推向屏幕边，下限 CARD_INSET_MIN。
 *           曾经做过两版被否掉的避让，别再回头：① 按每帧凸包把卡片推开（一转就挪）；
 *           ② 把相机退到任何机位都碰不到卡片的距离（卡片钉死了，但鞋垫小一圈约 20%）。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { HEAT_COLORS, DEFORM_ZONE_YN, medialSign, type DeformMm } from '@/lib/insoleModel';
import { routeLeader, makeLeaderPath, type LeaderPath } from '@/lib/leaderRoute';
import type { InsoleAnchor, InsoleProjection } from './StlInsoleViewer';

// ─── 设计稿几何 ───────────────────────────────────────────────────────────────

const CARD_W = 311;
const CARD_H = 222;

/** 卡内局部坐标（稿：左卡虚线右端 183 / 箭头 141；右卡 237 / 201。取一份居中的折中值） */
const DASH_X2 = 210;
const ARROW_X = 168;
const CHIP_X = 186;

/**
 * 两条虚线在卡内的 y(px)，**每张卡一组定值，不随参数变**。
 *
 * 定位：箭头是「这一段厚度加在哪儿」的示意，不是可量的标尺。数值由胶囊里的
 * ±x.xmm 承载，参数一变只有那个数变，虚线和箭头一动不动。
 *
 * 为什么不再按数值画长度（原来是 |v| / 满量程 × 150px）：满量程借用了热力图的
 * HEAT_MAX_MM=12，而足跟缓冲能调到 30mm ⇒ ≥12mm 一律顶满，15/20/25/30mm 画成同一根；
 * 顶满时箭头 150px，而实测后跟照片在卡内只有 162px 高（见下），等于圈住整个鞋跟，
 * 被读成「后跟总厚 15mm」。想改成严格等比也不行：足弓 2.5mm / (56.8+2.5) = 4.2% ⇒ 6px，
 * 低端会全糊在一起。既然本来就只是示意，索性钉死。
 *
 * 取值依据（按 objectFit:cover 反算出照片在 311×222 卡内的实际位置，逐像素量的）：
 *   后跟照片 占 y 28~190；顶沿那片带孔的小舌头在 y 30~55 ⇒ 上虚线落在舌头下方
 *   足弓照片 占 y 72~222；顶面脊线在 y 75~100        ⇒ 上虚线落在顶面上
 *
 * ⚠ 不再对称于卡片正中(y=111)：后跟这张是斜俯视，上下沿各自贴的是实物上不同的结构，
 *   强行对称会把下沿推到 162、压在外底轮廓上。胶囊与箭头改为居中于这两条线之间
 *   （见 CalloutCard 的 dashMid），不是卡片正中。
 */
const DASH_Y = {
  /** 上沿压在小舌头下方那圈跟杯壁上；下沿停在跟杯内壁中段，不落到外底轮廓上 */
  heel: { top: 60, bottom: 131 },
  /** 上沿贴着足弓顶面脊线。跨度 66px ≈ 旧公式在 5.3mm 处的长度，观感与改前一致 */
  arch: { top: 78, bottom: 144 },
} as const;

/** 引线端点离卡片近边留的空隙(px)（稿：左卡 445 → 引线止于 464） */
const LEAD_GAP = 19;
/** 最后一小截水平扎进卡片的长度(px)：箭头平着进卡，跟稿上一致 */
const LEAD_STUB = 16;
/** 引线端点在卡内的纵向落点要留边，别顶在圆角上 */
const LEAD_INSET = 18;
/** 引线起点圆点半径(px) */
const DOT_R = 6;

/** 设计稿上的卡片页边距（上限；窄窗口会往外推，见 CARD_INSET_MIN） */
const DESIGN_INSET_L = 134;
const DESIGN_INSET_R = 133;

/**
 * 卡片近边与包络边界之间要留的空隙(px)。
 * 取 14 是有来由的：包络由 32 个支撑点算出，是真实轮廓的**内**逼近（支撑点是顶点，
 * 不是切平面），加上着色器的顶面隆起（十几毫米）没算进去，实测两项合起来约 2px；
 * 剩下的余量留给引线绕行环（leaderRoute 的 HULL_CLEAR 也是 14）。
 * 再调大就要吃掉窄窗口的页边距（1595px 宽时页边距只剩 17px，下限是 12）。
 */
const EDGE_CLEAR = 14;

/**
 * 页边距的下限(px)：再往外推卡片就贴到屏幕边（右边还有色标要过）。
 *
 * 为什么页边距不能写死设计稿的 134：模型在屏幕上的宽度只由**画布高度**决定
 * （相机距离与 fov 固定），跟画布宽度无关。于是窗口一窄，两张卡之间的走廊
 * （宽 − 2×134 − 2×311）就比模型还窄，卡片必然压上去 ——
 * 1926px 宽的窗口走廊 1036px 刚够，1595px 宽的只剩 706px，而模型宽约 820px。
 *
 * 三个约束里（卡片不遮模型 / 卡片旋转时不动 / 模型保持原尺寸）唯一不花代价的余量
 * 就是把卡片往屏幕边上推，所以窄窗口往外推、宽窗口仍停在设计稿的 134。
 * 推到下限还装不下（很窄很高的窗口）就只能压一点 —— 缩小模型和旋转时挪卡片都被否过了。
 */
const CARD_INSET_MIN = 12;

/** 色标条（稿 x1796 y791 w14 h207；标签 #535353 ≈15px） */
const BAR_W = 14;
/** 稿上 207；本项目舞台矮，用短版（见 CompareLegend 注释） */
const BAR_H_SHORT = 150;

// ─── 锚点 ────────────────────────────────────────────────────────────────────

/**
 * 两个标注锚点。yN 取自 DEFORM_ZONE_YN（与形变公式同源）；
 * xN 上足弓要偏内侧 —— 内外侧朝向由 medialSign 决定，左右脚是反的，
 * 不能写死一个 0.75，否则右脚的引线会指到小趾侧那条棱上。
 */
export function compareAnchors(foot: 'left' | 'right'): InsoleAnchor[] {
  return [
    { id: 'heel', xN: 0.5, yN: DEFORM_ZONE_YN.heel },
    { id: 'arch', xN: 0.5 + 0.25 * medialSign(foot), yN: DEFORM_ZONE_YN.arch },
  ];
}

interface CardSpec {
  id: string;
  /** 钉在宿主的哪一侧 */
  side: 'left' | 'right';
  zone: string;
  img: string;
  /** 该锚点顶面抬起量(mm)，正=增厚 */
  valueMm: number;
  /** 两条虚线在卡内的 y(px)：定值，按这张照片量的，见 DASH_Y */
  dash: { top: number; bottom: number };
}

/**
 * 卡片数值 = 该区的**解决方案参数本身**（足弓矫正厚度 / 足跟缓冲厚度）。
 * DeformMm 里 archMm ≡ params.archCorrection、heelMm ≡ params.heelThickness
 * （见 insoleModel.personalDeform），所以这两个数与右侧参数面板上写的一字不差。
 *
 * ⚠ 别改回 topDisplacementMm(锚点)。那个量是「引线指的那一个点实际抬起多少」，
 *   带 cos² 剖面与内侧权重，在锚点上只有 0.83/0.88 倍 ——
 *   面板写 +3.5mm、卡片写 +2.89mm，用户看到的是两个对不上的数。
 *   「定制对比」这一屏存在的理由就是把参数讲直观，它必须是参数的可视化，
 *   不是另一套测量值。3D 的热力图仍按真实形变着色（那里本该带剖面衰减），
 *   卡片只负责把参数读出来。
 *
 * 足跟卡在右、足弓卡在左：默认机位（方位角 222°）下鞋垫的**足跟端朝屏幕右上**
 * （那个带小舌头的窄端是后跟，宽的一头是前掌），足弓落在中间偏左。
 * 反着放的话足跟那条引线要横穿整只鞋垫、还会和足弓那条交叉。
 */
function buildCards(deform: DeformMm): CardSpec[] {
  return [
    {
      id: 'arch',
      side: 'left',
      zone: '足弓区',
      img: '/assets/compare/section-arch.webp',
      valueMm: deform.archMm,
      dash: DASH_Y.arch,
    },
    {
      id: 'heel',
      side: 'right',
      zone: '足跟区',
      img: '/assets/compare/section-heel.webp',
      valueMm: deform.heelMm,
      dash: DASH_Y.heel,
    },
  ];
}

function fmtMm(v: number): string {
  // 负号用 U+2212（稿子上是这个），ASCII 连字符在等宽数字旁边会矮一截
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}mm`;
}

// ─── 标注卡 ──────────────────────────────────────────────────────────────────

function CalloutCard({
  spec,
  inset,
  cardRef,
}: {
  spec: CardSpec;
  /** 这一侧的页边距(px)：由模型的旋转不变包络算出来，见 CARD_INSET_MIN */
  inset: number;
  /** 引线要按卡片实测位置收边（top 带 CSS min()，随窗口高度变），所以把节点交出去 */
  cardRef: (el: HTMLDivElement | null) => void;
}) {
  const v = spec.valueMm;
  // 全是定值，与 v 无关：参数变只有下面那枚胶囊上的数字变，虚线/箭头一动不动（见 DASH_Y）
  const { top: y1, bottom: y2 } = spec.dash;
  const gap = y2 - y1;
  // 箭头与胶囊居中于这两条线之间，而不是卡片正中 —— 两张照片的取景高度不同，
  // 钉在卡片正中会让箭头尖探出虚线外（后跟那张尤其明显）
  const dashMid = (y1 + y2) / 2;
  const chipColor = v >= 0 ? HEAT_COLORS.pos : HEAT_COLORS.neg;

  return (
    <div
      ref={cardRef}
      title={`${spec.zone}：相对标准垫${v >= 0 ? '增厚' : '减薄'} ${Math.abs(v).toFixed(1)}mm`}
      style={{
        position: 'absolute',
        width: `${CARD_W}px`,
        height: `${CARD_H}px`,
        borderRadius: '10px',
        background: '#E9F0FF',
        border: '2px solid #0A3997',
        boxSizing: 'border-box',
        overflow: 'hidden',
        // 卡片本身要能 hover 出 title，但不能挡住底下 3D 的拖拽旋转
        pointerEvents: 'none',
        ...(spec.side === 'left'
          ? { left: `${inset}px`, top: `min(329px, calc(100% - ${CARD_H + 20}px))` }
          : { right: `${inset}px`, top: `min(195px, calc(100% - ${CARD_H + 20}px))` }),
      }}
    >
      <img
        src={spec.img}
        alt=""
        style={{ position: 'absolute', left: 0, top: 0, width: `${CARD_W}px`, height: `${CARD_H}px`, objectFit: 'cover', display: 'block' }}
      />

      {/* 两条橙色虚线：稿上 stroke #0A3997 / 2px / dasharray 8 */}
      {[y1, y2].map((y) => (
        <div
          key={y}
          style={{ position: 'absolute', left: 0, top: `${y}px`, width: `${DASH_X2}px`, height: 0, borderTop: '2px dashed #0A3997' }}
        />
      ))}

      {/* 黑色双向箭头（稿上是纯黑 #000，不是那支橙） */}
      <svg
        style={{ position: 'absolute', left: `${ARROW_X - 6}px`, top: `${y1}px` }}
        width="12"
        height={gap}
        viewBox={`0 0 12 ${gap}`}
        fill="none"
      >
        <line x1="6" y1="4" x2="6" y2={gap - 4} stroke="#000" strokeWidth="1.6" />
        <path d="M6,0.8 L2.2,6 L9.8,6 Z" fill="#000" />
        <path d={`M6,${gap - 0.8} L2.2,${gap - 6} L9.8,${gap - 6} Z`} fill="#000" />
      </svg>

      {/* 数值胶囊：颜色与 3D 上色、色标条共用 HEAT_COLORS 同一份，三处不会各说各话 */}
      <div
        style={{
          position: 'absolute',
          left: `${CHIP_X}px`,
          top: `${dashMid - 14}px`,
          height: '28px',
          padding: '0 9px',
          borderRadius: '6px',
          background: chipColor,
          color: '#fff',
          fontSize: '15px',
          fontWeight: 700,
          letterSpacing: '0.01em',
          display: 'flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {fmtMm(v)}
      </div>
    </div>
  );
}

// ─── 竖排色标 ────────────────────────────────────────────────────────────────

/**
 * 色标条。渐变两端与中点取 HEAT_COLORS（着色器同一份），
 * 中间那两个淡色停靠点(#FFE3C4 / #DAF7FF)与百分比是稿上量的，稿里就是这么个非线性过渡。
 */
function CompareLegend({ cards, fullScaleMm }: { cards: CardSpec[]; fullScaleMm: number }) {
  const grad = `linear-gradient(180deg, ${HEAT_COLORS.pos} 0%, #FFE3C4 41.263%, ${HEAT_COLORS.mid} 47.901%, ${HEAT_COLORS.mid} 52.143%, #DAF7FF 58.841%, ${HEAT_COLORS.neg} 100%)`;
  return (
    // 本项目的舞台比参考稿矮（约 760px vs 1008px），照稿 bottom:82 / 207 高会顶到右卡底边、
    // 「增厚」二字压进卡里。改为贴右下角、缩短到 BAR_H_SHORT：右卡底边 ≤ 195+222=417，
    // 色标含标签从 ~ 舞台底 −(48+150+22) 起，760 高的舞台上是 540，留出 120px 空隙。
    <div style={{ position: 'absolute', right: '40px', bottom: '48px', width: `${BAR_W}px`, height: `${BAR_H_SHORT}px`, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: `calc(100% + 5px)`, fontSize: '14px', fontWeight: 500, color: '#535353', whiteSpace: 'nowrap' }}>
        增厚
      </div>
      <div style={{ position: 'absolute', inset: 0, borderRadius: `${BAR_W / 2}px`, background: grad }} />
      <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: `calc(100% + 5px)`, fontSize: '14px', fontWeight: 500, color: '#535353', whiteSpace: 'nowrap' }}>
        减薄
      </div>

      {/* 每张卡一枚刻度三角（稿上只画了一枚 —— 稿是静态图、只标了一个值）。
          落点 = 该卡的数值在色标上的位置；超出满量程就贴在端点，与着色器 clamp 同口径。 */}
      {cards.map((c) => {
        const t = Math.min(1, Math.max(0, 0.5 - (c.valueMm / fullScaleMm) * 0.5));
        return (
          <svg
            key={c.id}
            style={{ position: 'absolute', left: '-18px', top: `${t * BAR_H_SHORT - 8}px` }}
            width="14"
            height="16"
            fill="none"
          >
            <title>{`${c.zone} ${fmtMm(c.valueMm)}`}</title>
            <path d="M1,1 L11,8 L1,15 Z" fill="#0A3997" />
          </svg>
        );
      })}
    </div>
  );
}

// ─── 引线层（每帧改属性，不重渲染） ──────────────────────────────────────────

export interface InsoleCompareOverlayHandle {
  /** 由 StlInsoleViewer 每帧回调；坐标都是画布内的 CSS 像素 */
  update: (proj: InsoleProjection) => void;
}

interface Props {
  deform: DeformMm;
  /**
   * **色标条专用**满量程(mm)：成品垫 HEAT_MAX_MM / 标准垫 HEAT_MAX_STD_MM，与着色器一致，
   * 决定三角刻度落在渐变条哪个位置（跨客户可比，所以必须跟颜色同一把尺）。
   * ⚠ 别再拿它去算卡片里虚线的间距 —— 虚线是定值示意，走 DASH_GAP。
   */
  fullScaleMm: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * LeaderPath + 末尾那一小截平进卡片 → SVG polyline 的 points 串。
 * 那一小截与路径最后一段共线（都是横的），所以不会多出一个折角。
 */
function pathToPoints(path: LeaderPath, tailX: number): string {
  let x0 = path.xs[0];
  let y0 = path.ys[0];
  // 首点从圆点边缘起，线头别从点里穿出来（路径全是横竖段，偏移沿轴，仍是直角）
  const dx = path.xs[1] - x0;
  const dy = path.ys[1] - y0;
  const len = Math.hypot(dx, dy) || 1;
  x0 += (dx / len) * DOT_R;
  y0 += (dy / len) * DOT_R;

  let s = `${r1(x0)},${r1(y0)}`;
  for (let i = 1; i < path.n; i++) s += ` ${r1(path.xs[i])},${r1(path.ys[i])}`;
  return `${s} ${r1(tailX)},${r1(path.ys[path.n - 1])}`;
}

export const InsoleCompareOverlay = forwardRef<InsoleCompareOverlayHandle, Props>(
  function InsoleCompareOverlay({ deform, fullScaleMm }, ref) {
    const cards = useMemo(() => buildCards(deform), [deform]);

    const hostRef = useRef<HTMLDivElement>(null);
    /**
     * 两侧页边距。**只随包络变**（缩放/平移/窗口尺寸/尺码），旋转一整圈都不动 ——
     * 这是唯一会 setState 的量，所以下面要靠 insetRef 挡住没变化的帧，
     * 否则 60fps 重渲染整页（见文件头注释）。
     */
    const [insets, setInsets] = useState({ l: DESIGN_INSET_L, r: DESIGN_INSET_R });
    const insetRef = useRef(insets);
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const dotRefs = useRef<Record<string, SVGCircleElement | null>>({});
    const lineRefs = useRef<Record<string, SVGPolylineElement | null>>({});
    /** 卡片矩形（宿主局部坐标）。每帧读 offsetTop 会强制 layout，改成布局变化时才量 */
    const rects = useRef<Record<string, { nearX: number; top: number; bottom: number }>>({});
    /** 宿主宽度：算右侧页边距要用。同样只在布局变化时量，别每帧读 clientWidth */
    const hostW = useRef(0);
    /** 上一帧写进 DOM 的 points 串，用于跳过没变的帧 */
    const lastPts = useRef<Record<string, string>>({});
    const path = useRef<LeaderPath>(makeLeaderPath());

    const measure = useCallback(() => {
      hostW.current = hostRef.current?.clientWidth ?? 0;
      for (const c of cards) {
        const el = cardRefs.current[c.id];
        if (!el) continue;
        const nearX = c.side === 'left' ? el.offsetLeft + el.offsetWidth : el.offsetLeft;
        rects.current[c.id] = { nearX, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight };
      }
      lastPts.current = {};
    }, [cards]);

    useEffect(() => {
      measure();
      const host = hostRef.current;
      if (!host) return;
      const ro = new ResizeObserver(measure);
      ro.observe(host);
      return () => ro.disconnect();
    }, [measure]);

    // 页边距一变，卡片位置就变了，引线得按新的矩形重新收边
    useEffect(measure, [insets, measure]);

    useImperativeHandle(
      ref,
      () => ({
        update(proj) {
          // ① 页边距：把卡片推到「转到任何角度都压不到模型」的地方，上限是设计稿的
          //    134/133。界取旋转不变包络（proj.rest*，与当前朝向无关），所以整圈旋转里
          //    这一步不会触发 setState；缩放会让它连续变，靠 >2px 的门限压住抖动。
          if (proj.restRight > 0 && hostW.current > 0) {
            const fit = (avail: number, design: number) =>
              Math.round(Math.min(design, Math.max(CARD_INSET_MIN, avail - EDGE_CLEAR - CARD_W)));
            const l = fit(proj.restLeft, DESIGN_INSET_L);
            const r = fit(hostW.current - proj.restRight, DESIGN_INSET_R);
            if (Math.abs(l - insetRef.current.l) > 2 || Math.abs(r - insetRef.current.r) > 2) {
              insetRef.current = { l, r };
              setInsets(insetRef.current);
            }
          }

          // ② 每根引线按当前投影重新路由
          for (const p of proj.points) {
            const card = cards.find((c) => c.id === p.id);
            const r = rects.current[p.id];
            const dot = dotRefs.current[p.id];
            const line = lineRefs.current[p.id];
            if (!card || !r || !dot || !line) continue;

            const out = card.side === 'left' ? 1 : -1;
            // 卡侧落点：横坐标钉在卡片近边外 LEAD_GAP；纵坐标交给路由在卡片高度内挑
            // （挑哪个高度能让横段少压在垫子上）。卡片本身一动不动。
            const attachX = r.nearX + out * LEAD_GAP;
            // 路由目标是「平进卡片那一小截的起点」，最后一小截才水平扎进卡片
            routeLeader(
              proj.hull, proj.hullLen, proj.hullCx, proj.hullCy,
              p.x, p.y,
              attachX + out * LEAD_STUB,
              r.top + LEAD_INSET, r.bottom - LEAD_INSET,
              path.current,
            );
            const pts = pathToPoints(path.current, attachX);
            if (lastPts.current[p.id] === pts) continue;
            lastPts.current[p.id] = pts;

            dot.setAttribute('cx', String(r1(p.x)));
            dot.setAttribute('cy', String(r1(p.y)));
            line.setAttribute('points', pts);
          }
        },
      }),
      [cards],
    );

    return (
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
        {/* 引线画在卡片下面：线头压进卡片近边时被卡片盖住，不会从圆角上跨过去 */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} fill="none">
          <defs>
            <marker id="cmpArrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
              <path d="M0,0.6 L8,4.5 L0,8.4" fill="none" stroke="#0A3997" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {cards.map((c) => (
            <g key={c.id}>
              {/* 初始放在画布外：首帧 useFrame 还没跑，别让圆点闪在左上角 */}
              <polyline
                ref={(el) => { lineRefs.current[c.id] = el; }}
                points="-99,-99 -99,-99"
                stroke="#0A3997" strokeWidth="1.5" strokeLinejoin="round" fill="none"
                markerEnd="url(#cmpArrow)"
              />
              <circle ref={(el) => { dotRefs.current[c.id] = el; }} cx="-99" cy="-99" r={DOT_R} fill="#0A3997" />
            </g>
          ))}
        </svg>

        {cards.map((c) => (
          <CalloutCard
            key={c.id}
            spec={c}
            inset={c.side === 'left' ? insets.l : insets.r}
            cardRef={(el) => {
              cardRefs.current[c.id] = el;
              if (el) measure();
            }}
          />
        ))}

        <CompareLegend cards={cards} fullScaleMm={fullScaleMm} />
      </div>
    );
  },
);

export default InsoleCompareOverlay;
