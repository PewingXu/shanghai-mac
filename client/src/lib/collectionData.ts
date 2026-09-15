/**
 * 导入数据解析：把设备软件导出的 sit*.csv（或本系统落盘的 records/<id>.csv）
 * 解析成压力帧数组（每帧 4096 值，与串口帧同构，可直接回放 + 送分析）。
 *
 * CSV 约定：表头含 `data` 列，每行该列是引号包裹的 4096 长度数组字面量 "[0,0,3,...]"。
 * JSON 约定：纯二维数组，或 { format:'foot-pressure-collection', frames:[...] }。
 */
const FRAME_SIZE = 4096;

export function parseCSVData(csvText: string): number[][] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV 内容为空");

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  if (!headers.includes("data")) {
    throw new Error('CSV 文件缺少 "data" 列');
  }

  const frames: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const match = lines[i].match(/\[([^\]]+)\]/);
    if (!match) continue;
    const values = match[1].split(",").map((v) => Number(v.trim()));
    if (values.length === FRAME_SIZE && !values.some((v) => Number.isNaN(v))) {
      frames.push(values);
    }
  }
  return frames;
}

function normalizeFrames(frames: unknown): number[][] {
  if (!Array.isArray(frames)) throw new Error("数据文件缺少有效的帧数组");
  return frames.map((frame, index) => {
    if (!Array.isArray(frame)) throw new Error(`第 ${index + 1} 帧不是数组`);
    const out = frame.map((v) => Number(v));
    if (out.length !== FRAME_SIZE) throw new Error(`第 ${index + 1} 帧长度为 ${out.length}，应为 ${FRAME_SIZE}`);
    if (out.some((v) => Number.isNaN(v))) throw new Error(`第 ${index + 1} 帧包含无效数值`);
    return out;
  });
}

export function parseJSONCollectionData(jsonText: string): number[][] {
  const parsed = JSON.parse(jsonText) as { frames?: unknown } | unknown[];
  if (Array.isArray(parsed)) return normalizeFrames(parsed);
  return normalizeFrames(parsed.frames);
}

/** 按文件扩展名分派解析；返回帧数组（可能为空，由调用方提示） */
export async function parseCollectionFile(file: File): Promise<number[][]> {
  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJSONCollectionData(text);
  return parseCSVData(text);
}

/** 4096 平铺帧 → 64×64 矩阵（与串口帧回调同构） */
export function reshapeFrame(flat: number[]): number[][] {
  const m: number[][] = [];
  for (let r = 0; r < 64; r++) m.push(flat.slice(r * 64, (r + 1) * 64));
  return m;
}
