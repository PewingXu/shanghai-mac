/**
 * 足垫 ADC → 压强 标定公式（tools/calibrate_pressure.html 拟合结果）
 *
 * 矩侨足垫 64×64 标定  2026/9/16 15:29:10  n=249  R²=0.851391
 * x = 有效点 ADC 均值 (0-255)，y = 压强 (kPa)；压头 900 mm²，噪声阈值 14
 * 拟合形式：幂函数 kPa = a·(ADC − x₀)^b，x₀ 为起压阈值
 *
 * 这是【单个传感点】的 ADC→kPa 曲线，与接触面积无关：整帧逐格换算后
 *   总力 N     = Σ kPa × 1000 × 单格面积(m²)
 *   平均压强   = 总力 / (有效格数 × 单格面积)
 * 任何脚型都成立。重新标定后只需替换 adcToKpa 里的三个系数。
 */
export const CELL_AREA_M2 = 49e-6; // 7mm 间距，单格 49 mm²

/** 单个传感点 ADC(0-255) → 压强 kPa */
export const adcToKpa = (x: number): number =>
  x > 33.369689 ? 0.000012532359 * Math.pow(x - 33.369689, 3.8066471) : 0;

/** 整帧 → 总力 N：Σ kPa×1000 × 单格面积 */
export function frameToNewton(frame: number[][], threshold: number): number {
  let n = 0;
  for (const row of frame) for (const v of row) if (v > threshold) n += adcToKpa(v) * 1000 * CELL_AREA_M2;
  return n;
}

/** 平均压强 kPa = 总力 / 接触面积 */
export function frameMeanKpa(frame: number[][], threshold: number): number {
  let n = 0,
    cells = 0;
  for (const row of frame)
    for (const v of row)
      if (v > threshold) {
        n += adcToKpa(v) * 1000 * CELL_AREA_M2;
        cells++;
      }
  return cells ? n / (cells * CELL_AREA_M2) / 1000 : 0;
}
