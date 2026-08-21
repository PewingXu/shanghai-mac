/**
 * 鞋垫参数与足弓分级算法（纯函数）
 *
 * 摘自旧项目 foot-pressure-report 的 components/LatticeInsole3D.tsx，
 * 只保留参数类型与无 three 依赖的纯计算函数，供解决方案页与 STL 导出复用。
 *
 * 7 级人体工学足弓分级 + 压力自适应基础厚度。
 */

export interface InsoleParams {
  footLength: number;   // cm
  footWidth: number;    // cm
  archCorrection: number; // mm（矫正厚度 ΔHS）
  archLevel: number;    // 1-7 级
  archType: string;     // 足型描述
  baseThickness: number; // cm 基础厚度（根据压力调整）
  pressureRatio: number; // 该脚的压力占比 (0-1)
  heelThickness: number; // mm 足跟缓冲厚度 (0-30mm)
  latticeDensity: number; // 晶格体密度档位 (1-5)
}

/**
 * 根据足弓指数(AI)返回足弓等级(1-7)及相关信息
 *
 * 分档边界以报告页为准。报告显示的是 Python 的 area_type，多帧测量走
 * OneStep_report.py 的三档表：AI <0.21 高足弓 / 0.21~0.26 正常足弓 / >0.26 扁平足。
 * 这里的七档必须嵌在那三档里面，否则同一个 AI 两页会给出相反结论
 * —— 原先 L3/L4 的界写成 0.20，AI 落在 0.20~0.21 时报告判高足弓、方案判正常足，
 * 左右脚 AI 常差 0.01~0.03，于是经常只有一只脚对不上。界改成 0.21 后：
 *   L1~L3 ⊂ 高足弓，L4 = 正常足弓，L5~L7 ⊂ 扁平足，方向永不冲突，方案只是分得更细。
 */
export function getArchLevelFromAI(archIndex: number): { level: number; type: string; correction: number } {
  if (archIndex <= 0.10) return { level: 1, type: '重度高弓足', correction: 10.0 };
  if (archIndex <= 0.15) return { level: 2, type: '中度高弓足', correction: 8.0 };
  if (archIndex < 0.21) return { level: 3, type: '轻度高弓足', correction: 6.0 };
  if (archIndex <= 0.26) return { level: 4, type: '正常足', correction: 2.5 };
  if (archIndex <= 0.31) return { level: 5, type: '轻度扁平足', correction: 4.0 };
  if (archIndex <= 0.36) return { level: 6, type: '中度扁平足', correction: 6.0 };
  return { level: 7, type: '重度扁平足', correction: 8.0 };
}

/** 根据足弓等级返回对应颜色 */
export function getArchLevelColor(level: number): string {
  const colors: Record<number, string> = {
    1: '#EF4444', 2: '#F97316', 3: '#EAB308', 4: '#22C55E',
    5: '#EAB308', 6: '#F97316', 7: '#EF4444',
  };
  return colors[level] || colors[4];
}

/** 根据足弓等级返回分区硬度(Shore A) */
export function getZoneHardness(level: number): { forefoot: number; arch: number; heel: number } {
  const hardnessMap: Record<number, { forefoot: number; arch: number; heel: number }> = {
    1: { forefoot: 35, arch: 48, heel: 42 },
    2: { forefoot: 36, arch: 46, heel: 41 },
    3: { forefoot: 37, arch: 44, heel: 40 },
    4: { forefoot: 38, arch: 42, heel: 40 },
    5: { forefoot: 36, arch: 38, heel: 38 },
    6: { forefoot: 34, arch: 35, heel: 36 },
    7: { forefoot: 32, arch: 32, heel: 34 },
  };
  return hardnessMap[level] || hardnessMap[4];
}

/**
 * 根据足弓等级返回整垫推荐软硬（单个 Shore A 值）。
 * 取分区硬度(getZoneHardness)前掌/足弓/后跟三区平均并四舍五入，作为「软硬调节」滑块的系统默认值。
 */
export function getInsoleHardness(level: number): number {
  const z = getZoneHardness(level);
  return Math.round((z.forefoot + z.arch + z.heel) / 3);
}

/** 根据足弓等级返回矫正设计逻辑描述 */
export function getArchDesignLogic(level: number): string {
  const logic: Record<number, string> = {
    1: '重度矫正：显著抬高足弓，增加内侧支撑，限制过度旋前，重建足弓结构',
    2: '中度矫正：适度抬高足弓，加强内侧支撑，引导正常步态力线',
    3: '轻度矫正：轻微抬高足弓，提供温和支撑，预防足弓进一步塌陷',
    4: '生理维持：不改变足弓形态，仅提供动态反馈，维持现有健康状态',
    5: '轻度缓冲：增加足底缓冲，分散高弓集中压力，改善舒适度',
    6: '中度缓冲：显著增加缓冲层，降低跖骨头和足跟集中压力',
    7: '重度缓冲：最大化缓冲与减压，全面分散异常集中的足底压力',
  };
  return logic[level] || logic[4];
}

/** 根据足弓等级返回矫正厚度ΔHS(mm) */
export function getArchCorrectionFromLevel(level: number): number {
  const corrections: Record<number, number> = {
    1: 8.0, 2: 6.0, 3: 4.0, 4: 2.5,
    5: 1.5, 6: 0.5, 7: 0.0,
  };
  return corrections[level] ?? 2.5;
}

/** 根据左右脚压力占比计算基础厚度调整（cm） */
export function calculatePressureAdaptiveThickness(
  leftPressureRatio: number,
  rightPressureRatio: number,
  baseThickness: number = 0.3,
): { leftThickness: number; rightThickness: number } {
  const lr = Math.max(0, Math.min(1, leftPressureRatio));
  const rr = Math.max(0, Math.min(1, rightPressureRatio));

  const idealRatio = 0.5;
  const leftDeviation = lr - idealRatio;
  const rightDeviation = rr - idealRatio;
  const maxAdjust = baseThickness * 0.4; // 最大调整量为基厚的40%
  const leftAdjust = leftDeviation * maxAdjust * 2;
  const rightAdjust = rightDeviation * maxAdjust * 2;

  // clamp 输出到 0.15cm(1.5mm) - 0.6cm(6mm)
  return {
    leftThickness: Math.max(0.15, Math.min(0.6, baseThickness + leftAdjust)),
    rightThickness: Math.max(0.15, Math.min(0.6, baseThickness + rightAdjust)),
  };
}
