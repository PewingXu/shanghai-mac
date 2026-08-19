/**
 * 解决方案快照：把解决方案页改过的参数打包存进采集记录，历史回看时原样还原。
 *
 * 只存"用户改过的选择"，不存能算出来的东西 —— 分析结果本身已经在
 * data/records/<id>.json 里，页面每次都会从它重算一遍系统推荐值。
 *
 * ⚠ baseThickness 存的是【相对系统基准的增量】而不是绝对值。
 * 基础厚度现在是派生量（SolutionPage.baseThicknessCmForSize：按鞋码档算基准 + 用户增量），
 * 恢复时那个 effect 一定会按当前样式/鞋码重算基准，存绝对值会被它当场覆盖。
 */
import type { InsoleParams } from './insoleLogic';
import type { InsoleStyle } from './insoleModel';
import type { ShellAdjust } from './shoeShell';

export type SnapshotSide = 'left' | 'right';

/**
 * 与 StlInsoleViewer 的 ShellView 同一套字面量。这里写字面量而不是 import ——
 * lib 层不依赖 component 层；漂移由 SolutionPage 里 setShellView(snap.shellView) 那处赋值让 tsc 抓。
 */
export type SnapshotShellView = 'off' | 'only' | 'assembly';

export interface SnapshotFoot {
  /** 绝对值留档（排查用）；恢复时 baseThickness 一项以 baseDeltaMm 为准 */
  params: InsoleParams;
  hardness: number;
  shoeSize: number;
  /** (committed.baseThickness − defaults.baseThickness) × 10，单位 mm */
  baseDeltaMm: number;
}

export interface SolutionSnapshot {
  v: 1;
  insoleStyle: InsoleStyle;
  insoleColor: string;
  /** 用户手填的鞋垫尺寸（原样存字符串，空串就是没填） */
  insoleSize: Record<SnapshotSide, { length: string; width: string }>;
  /** 选中的鞋壳 ShellSource.id（字节在后端 data/shells/，这里只记 id） */
  shellSourceId?: string;
  /** 鞋壳真名。存一份是为了「当前：xxx」进页面就对，不必等 /shells 回来 */
  shellLabel?: string;
  /** 鞋壳视图：仅鞋垫 / 仅鞋壳 / 装配。缺省（老快照）按 'off' 走 */
  shellView?: SnapshotShellView;
  /** 装配视图的鞋壳透明度 */
  shellOpacity?: number;
  /**
   * 鞋壳手动摆位。后端也按鞋壳记着一份全局值，但还原时以快照这份为准 ——
   * 历史记录要还原「这条记录当时长什么样」，用户后来重新校正过那款鞋壳不该改写旧记录。
   */
  shellAdjust?: ShellAdjust;
  feet: Record<SnapshotSide, SnapshotFoot>;
}

interface FootLike {
  params: InsoleParams;
  hardness: number;
  shoeSize: number;
}

/** 打包：committed（用户当前值）+ defaults（系统推荐值）→ 快照 */
export function buildSolutionSnapshot(opts: {
  insoleStyle: InsoleStyle;
  insoleColor: string;
  insoleSize: Record<SnapshotSide, { length: string; width: string }>;
  shellSourceId?: string;
  shellLabel?: string;
  shellView?: SnapshotShellView;
  shellOpacity?: number;
  shellAdjust?: ShellAdjust;
  committed: Record<SnapshotSide, FootLike>;
  defaults: Record<SnapshotSide, FootLike>;
}): SolutionSnapshot {
  const foot = (s: SnapshotSide): SnapshotFoot => ({
    params: { ...opts.committed[s].params },
    hardness: opts.committed[s].hardness,
    shoeSize: opts.committed[s].shoeSize,
    baseDeltaMm: (opts.committed[s].params.baseThickness - opts.defaults[s].params.baseThickness) * 10,
  });
  return {
    v: 1,
    insoleStyle: opts.insoleStyle,
    insoleColor: opts.insoleColor,
    insoleSize: {
      left: { ...opts.insoleSize.left },
      right: { ...opts.insoleSize.right },
    },
    shellSourceId: opts.shellSourceId,
    shellLabel: opts.shellLabel,
    shellView: opts.shellView,
    shellOpacity: opts.shellOpacity,
    shellAdjust: opts.shellAdjust ? { ...opts.shellAdjust } : undefined,
    feet: { left: foot('left'), right: foot('right') },
  };
}

/**
 * 解包某一只脚：快照参数 + 当前这套系统基准 → 可直接塞进 committed 的值。
 * 基础厚度 = 当次算出的基准 + 快照里的增量，所以换样式/换鞋码后增量依旧成立。
 */
export function restoreFoot(snap: SnapshotFoot, sysBaseThicknessCm: number): FootLike {
  return {
    params: { ...snap.params, baseThickness: sysBaseThicknessCm + snap.baseDeltaMm / 10 },
    hardness: snap.hardness,
    shoeSize: snap.shoeSize,
  };
}

/** 快照是不是本代码认得的（老版本/脏数据一律当没有） */
export function isSolutionSnapshot(x: unknown): x is SolutionSnapshot {
  const s = x as SolutionSnapshot | null;
  return !!s && s.v === 1 && !!s.feet?.left && !!s.feet?.right;
}

/** 「2026-08-19 15:07」——存进 solution_updated_at 的本地时间戳 */
export function localStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
}
