/**
 * 解决方案页数据层
 *
 * 数据源优先级（与 ReportPage 保持同一份分析结果，避免两页结论打架）：
 *   1. AppContext.analysis.python.data —— 测量页/历史回放已经算好的 Python 结果，
 *      经 solutionFromPythonData() 直接换算，不重跑分析。这是常规路径。
 *   2. 原始帧 frames —— 只有拿不到 1 的场景才走 loadSolution(frames) 现场跑一次后端。
 *   3. 演示默认值 DEMO —— 前两者都没有时的兜底。注意 DEMO 恒为「正常足 / 44 码」，
 *      一旦页面显示这组值就说明真实数据没接上（backend=false 可据此提示用户）。
 */

import type { PythonAnalysisResult } from './pythonApi';
import { checkPythonBackend, analyzePython, convertPythonResult } from './pythonApi';
import {
  getArchLevelFromAI,
  calculatePressureAdaptiveThickness,
  getInsoleHardness,
  type InsoleParams,
} from './insoleLogic';
import { lookupInsoleSize } from './insoleSize';
import type { FootReport } from './FootAnalysis';

/** 单脚解决方案数据 */
export interface FootSolution {
  params: InsoleParams;
  /** 整垫软硬（邵氏硬度 Shore A）；晶格密度档位见 params.latticeDensity */
  hardness: number;
  shoeSize: number;
}

export interface SolutionData {
  left: FootSolution;
  right: FootSolution;
  /** 是否取自 Python 后端真实结果 */
  backend: boolean;
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
    // 软硬（Shore A）：由足弓等级推导的整垫推荐硬度
    hardness: getInsoleHardness(archLevel),
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
    // 软硬（Shore A）：由足弓等级推导的整垫推荐硬度
    hardness: getInsoleHardness(arch.level),
    shoeSize: size.shoeSize,
  };
}

/**
 * 由「已经算好的」Python 分析结果换算解决方案参数。
 *
 * 与 ReportPage 共用 analysis.python.data 这一份数据，所以两页的足弓指数必定一致；
 * 历史记录回放时 rawFrames 不会落盘（见 AppContext.slimAnalysisForStorage），
 * 只有这条路径能让历史记录也出真实解决方案。
 */
export function solutionFromPythonData(data: PythonAnalysisResult['data']): SolutionData {
  const report = convertPythonResult(data);

  // 按左右脚压力占比自适应基础厚度
  const lr = report.bilateral.leftPressureRatio / 100;
  const rr = report.bilateral.rightPressureRatio / 100;
  const adaptive = calculatePressureAdaptiveThickness(lr, rr, 0.3);

  return {
    left: footSolutionFromReport(report, 'left', adaptive.leftThickness),
    right: footSolutionFromReport(report, 'right', adaptive.rightThickness),
    backend: true,
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
    return solutionFromPythonData(res.data);
  } catch (err) {
    console.warn('[solutionData] 后端分析失败，使用演示默认值:', err);
    return DEMO;
  }
}
