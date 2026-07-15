/**
 * 解决方案页数据层
 *
 * 优先尝试 Python 分析后端；若后端不可用或没有采集帧数据，回退到演示默认值
 * （与 ReportPage 当前一致——App 尚未把采集帧串到各页面）。
 * 后续把 frames 经 AppContext 串入 loadSolution()，即可自动启用后端真实结果。
 */

import { checkPythonBackend, analyzePython, convertPythonResult } from './pythonApi';
import {
  getArchLevelFromAI,
  calculatePressureAdaptiveThickness,
  getZoneSupportCompensation,
  type ZoneSupportCompensation,
  type InsoleParams,
} from './insoleLogic';
import { lookupInsoleSize } from './insoleSize';
import type { FootReport } from './FootAnalysis';

/** 分区加厚量（mm）：前掌 / 足弓(中足) / 后跟 */
export interface RegionBoost {
  forefoot: number;
  midfoot: number;
  hindfoot: number;
}

/** 单脚解决方案数据 */
export interface FootSolution {
  params: InsoleParams;
  regionBoost: RegionBoost;
  shoeSize: number;
}

export interface SolutionData {
  left: FootSolution;
  right: FootSolution;
  /** 是否取自 Python 后端真实结果 */
  backend: boolean;
}

// 分区支撑补偿 → RegionBoost 命名映射（arch→midfoot, heel→hindfoot）
function toRegionBoost(z: ZoneSupportCompensation): RegionBoost {
  return { forefoot: z.forefoot, midfoot: z.arch, hindfoot: z.heel };
}

// ─── 演示默认值（对齐设计稿示例：成人男 44 码） ──────────────────────────────
function demoFoot(): FootSolution {
  const footLength = 27.0; // cm
  const size = lookupInsoleSize(footLength, 'adult_male');
  const archLevel = 4;
  const baseThickness = 0.3; // cm = 3.0mm
  const heelThickness = 10;
  const pressureRatio = 0.5;
  return {
    params: {
      footLength,
      footWidth: size.footWidthCm,
      archCorrection: 2.5,
      archLevel,
      archType: '正常足',
      baseThickness,
      pressureRatio,
      heelThickness,
      latticeDensity: 3,
    },
    // 分区补偿：v1.0 决策逻辑（足弓等级/压力占比/足跟厚度 → ±1.5mm）
    regionBoost: toRegionBoost(getZoneSupportCompensation(archLevel, baseThickness, heelThickness, pressureRatio)),
    shoeSize: size.shoeSize,
  };
}

const DEMO: SolutionData = {
  left: demoFoot(),
  right: demoFoot(),
  backend: false,
};

function footSolutionFromReport(
  report: FootReport,
  side: 'left' | 'right',
  baseThicknessCm: number,
): FootSolution {
  const foot = report[side];
  const ratioPct =
    side === 'left'
      ? report.bilateral.leftPressureRatio
      : report.bilateral.rightPressureRatio;

  // length/width: Python 返回多为 mm，统一转 cm 并 0.5 步进
  const rawLen = foot.length || 270;
  const rawWid = foot.width || 95;
  const footLength = Math.round((rawLen > 50 ? rawLen / 10 : rawLen) * 2) / 2;
  const footWidth = Math.round((rawWid > 30 ? rawWid / 10 : rawWid) * 2) / 2;

  const ai = foot.archAnalysis.archIndex ?? 0.24;
  const arch = getArchLevelFromAI(ai);
  const size = lookupInsoleSize(footLength, 'adult_male');

  const heelDefaults: Record<number, number> = { 1: 25, 2: 20, 3: 15, 4: 10, 5: 15, 6: 20, 7: 25 };
  const heelThickness = heelDefaults[arch.level] ?? 10;
  const pressureRatio = Math.max(0, Math.min(1, ratioPct / 100));

  return {
    params: {
      footLength,
      footWidth,
      archCorrection: arch.correction,
      archLevel: arch.level,
      archType: arch.type,
      baseThickness: baseThicknessCm,
      pressureRatio,
      heelThickness,
      latticeDensity: 3,
    },
    // 分区补偿：v1.0 决策逻辑（足弓等级主导 + 压力占比偏差 + 足跟厚度 → ±1.5mm）
    regionBoost: toRegionBoost(getZoneSupportCompensation(arch.level, baseThicknessCm, heelThickness, pressureRatio)),
    shoeSize: size.shoeSize,
  };
}

/**
 * 加载解决方案数据。
 * @param frames 采集帧数据（每帧 4096 值）；不传则直接回退演示值。
 */
export async function loadSolution(frames?: number[][]): Promise<SolutionData> {
  if (!frames || frames.length === 0) return DEMO;

  try {
    const ok = await checkPythonBackend();
    if (!ok) return DEMO;

    const res = await analyzePython(frames);
    const report = convertPythonResult(res.data);

    // 按左右脚压力占比自适应基础厚度
    const lr = report.bilateral.leftPressureRatio / 100;
    const rr = report.bilateral.rightPressureRatio / 100;
    const adaptive = calculatePressureAdaptiveThickness(lr, rr, 0.3);

    return {
      left: footSolutionFromReport(report, 'left', adaptive.leftThickness),
      right: footSolutionFromReport(report, 'right', adaptive.rightThickness),
      backend: true,
    };
  } catch (err) {
    console.warn('[solutionData] 后端分析失败，使用演示默认值:', err);
    return DEMO;
  }
}
