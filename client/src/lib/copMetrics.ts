/**
 * 单条 COP 轨迹 → 「COP 平衡指标」8 项，与后端 OneStep_report._cop_time_series_of 逐行对齐。
 *
 * 用途：老记录（2026-09-16 之前分析的）只有合并字段 cop_time_series（后端算的是点数多的那只脚），
 * 没有逐脚字段；但 left/right_cop_trajectory 一直都存着。报告页拿轨迹现算，老记录也能左右切换。
 * 新记录仍以后端 cop_time_series_left/_right 为准，本文件只做兜底。
 *
 * 口径（与 Python 完全一致，别改单边）：
 *   - 传感点间距 7mm：长度类 ×7、面积 ×49
 *   - dt = 0.024s（约 42fps）；velocity_series 前面补一个 0 再取均值
 *   - 协方差按 numpy 默认 ddof=1；标准差按 numpy 默认 ddof=0
 *   - major/minor axis = 2·√λ·7，保留两位小数（Python 那边 np.round(…, 2)）
 *   - 凸包面积用 Andrew 单调链 + 鞋带公式（Python 用 scipy ConvexHull.volume，二维即面积）
 */
import type { PythonCOPTimeSeries } from './pythonApi';
import { convexHull } from './leaderRoute';

const PITCH_MM = 7;
const DT = 0.024;

const ZERO: PythonCOPTimeSeries = {
  path_length: 0,
  contact_area: 0,
  ls_ratio: 0,
  eccentricity: 0,
  major_axis: 0,
  minor_axis: 0,
  delta_x: 0,
  delta_y: 0,
  max_displacement: 0,
  min_displacement: 0,
  avg_velocity: 0,
  rms_displacement: 0,
  center_bias: 0,
  std_x: 0,
  std_y: 0,
  time_series: null,
  time_points: [],
  velocity_series: [],
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 鞋带公式：扁平顶点数组 [x,y,…] 前 m 个点围成的多边形面积 */
function polygonArea(pts: number[], m: number): number {
  let s = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return Math.abs(s) / 2;
}

export function copMetricsFromTrajectory(traj: number[][] | null | undefined): PythonCOPTimeSeries {
  const pts = (traj ?? []).filter((p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]));
  const n = pts.length;
  if (n === 0) return { ...ZERO };

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const cx = mean(xs);
  const cy = mean(ys);

  // 速度序列（首项补 0）与路径长度
  const velocity: number[] = [0];
  let path = 0;
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    const d = Math.hypot(dx, dy);
    path += d;
    velocity.push((d / DT) * PITCH_MM);
  }
  path *= PITCH_MM;

  // 凸包面积
  let contactArea = 0;
  if (n >= 3) {
    const flat: number[] = [];
    for (let i = 0; i < n; i++) flat.push(xs[i], ys[i]);
    const hull: number[] = [];
    const m = convexHull(flat, n, hull);
    contactArea = m >= 3 ? polygonArea(hull, m) * PITCH_MM * PITCH_MM : 0;
  }

  const ptp = (a: number[]) => Math.max(...a) - Math.min(...a);
  const deltaX = ptp(xs) * PITCH_MM;
  const deltaY = ptp(ys) * PITCH_MM;

  // 2×2 协方差（ddof=1）的特征值 → 主/次轴
  let major = deltaX;
  let minor = deltaY;
  if (n > 1) {
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - cx;
      const dy = ys[i] - cy;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const k = n - 1;
    const a = sxx / k;
    const b = sxy / k;
    const c = syy / k;
    const tr = a + c;
    const det = a * c - b * b;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    major = round2(2 * Math.sqrt(Math.max(0, l1)) * PITCH_MM);
    minor = round2(2 * Math.sqrt(Math.max(0, l2)) * PITCH_MM);
  }

  const disp = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy) * PITCH_MM);
  const maxDisp = Math.max(...disp);
  const minDisp = Math.min(...disp);
  const rmsDisp = Math.sqrt(mean(disp.map((v) => v * v)));
  const avgVel = mean(velocity);
  // 标准差 ddof=0
  const stdX = Math.sqrt(mean(xs.map((v) => (v - cx) * (v - cx)))) * PITCH_MM;
  const stdY = Math.sqrt(mean(ys.map((v) => (v - cy) * (v - cy)))) * PITCH_MM;

  return {
    path_length: path,
    contact_area: contactArea,
    ls_ratio: minor > 0 ? major / minor : 0,
    eccentricity: major > 0 ? Math.sqrt(Math.max(0, 1 - (minor / major) ** 2)) : 0,
    major_axis: major,
    minor_axis: minor,
    delta_x: deltaX,
    delta_y: deltaY,
    max_displacement: maxDisp,
    min_displacement: minDisp,
    avg_velocity: avgVel,
    rms_displacement: rmsDisp,
    center_bias: (Math.atan2(cy, cx) * 180) / Math.PI,
    std_x: stdX,
    std_y: stdY,
    time_series: velocity,
    time_points: pts.map((_, i) => i * DT),
    velocity_series: velocity,
  };
}
