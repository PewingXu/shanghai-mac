/**
 * 后端持久化 API 封装（用户 / 采集记录）。
 * 挂在 Python 后端(8766)：dev 经 Vite 代理 /pyapi，生产直连 127.0.0.1:8766
 * ——与 pythonApi.ts 同一后端、同一 base 规则。
 */
const BASE = import.meta.env.DEV ? "/pyapi" : "http://127.0.0.1:8766";

export interface ApiUser {
  id: number;
  name: string;
  gender?: string;
  birthDate?: string;
  height?: number;
  weight?: number;
  shoeSize?: string;
  phone?: string;
  email?: string;
}

/** 列出所有用户；后端不可用时抛错，由调用方兜底 */
export async function apiListUsers(): Promise<ApiUser[]> {
  const res = await fetch(`${BASE}/users`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`list users failed: ${res.status}`);
  const data = await res.json();
  return (data.users ?? []) as ApiUser[];
}

/** 下一个将分配的自增用户 id（创建弹窗标题展示；真正分配以创建返回为准） */
export async function apiNextUserId(): Promise<number> {
  const res = await fetch(`${BASE}/users/next-id`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`next-id failed: ${res.status}`);
  const data = await res.json();
  return data.id as number;
}

/** 新建用户（服务端保证 id 唯一），返回完整用户 */
export async function apiCreateUser(u: Partial<ApiUser> & { name: string }): Promise<ApiUser> {
  const res = await fetch(`${BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(u),
  });
  if (!res.ok) throw new Error(`create user failed: ${res.status}`);
  const data = await res.json();
  return data.user as ApiUser;
}

/** 编辑用户基础信息（按 id），返回更新后的完整用户 */
export async function apiUpdateUser(u: Partial<ApiUser> & { id: number; name: string }): Promise<ApiUser> {
  const res = await fetch(`${BASE}/users/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(u),
  });
  if (!res.ok) throw new Error(`update user failed: ${res.status}`);
  const data = await res.json();
  return data.user as ApiUser;
}

/** 按 id 批量删除用户 */
export async function apiDeleteUsers(ids: number[]): Promise<void> {
  const res = await fetch(`${BASE}/users/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(`delete users failed: ${res.status}`);
}

// ─── 采集记录（元数据进 SQLite；分析 JSON / 原始 CSV 落盘） ────────────────────
export interface ApiRecord {
  id: number;
  userId: number;
  date: string;
  time: string;
  /** 最后一次保存解决方案的时间（记录行「方案更新时间」列）；从未编辑过为 undefined */
  solutionUpdatedAt?: string;
}

/** 列出某用户的全部采集记录（按时间倒序，仅元数据 + 方案时间戳） */
export async function apiListRecords(userId: number): Promise<ApiRecord[]> {
  const res = await fetch(`${BASE}/users/${userId}/records`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`list records failed: ${res.status}`);
  const data = await res.json();
  return (
    (data.records ?? []) as Array<{
      id: number;
      user_id: number;
      date: string;
      time: string;
      solution_updated_at?: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    date: r.date,
    time: r.time,
    solutionUpdatedAt: r.solution_updated_at ?? undefined,
  }));
}

/** 保存一次采集：分析结果（已瘦身）+ 可选原始帧（服务端落盘为仿 sit 格式 CSV） */
export async function apiCreateRecord(
  userId: number,
  date: string,
  time: string,
  data: unknown,
  rawFrames?: number[][],
  fps = 42,
): Promise<ApiRecord> {
  const res = await fetch(`${BASE}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, date, time, data, raw_frames: rawFrames ?? null, fps }),
  });
  if (!res.ok) throw new Error(`create record failed: ${res.status}`);
  const out = await res.json();
  const r = out.record as { id: number; user_id: number; date: string; time: string };
  return { id: r.id, userId: r.user_id, date: r.date, time: r.time };
}

/** 读回单条采集的完整分析数据（用于报告页重新渲染那次的交互报告） */
export async function apiGetRecordData<T = unknown>(recordId: number): Promise<T> {
  const res = await fetch(`${BASE}/records/${recordId}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`get record failed: ${res.status}`);
  const data = await res.json();
  return data.data as T;
}

/** 删除单条采集记录（连同落盘文件） */
export async function apiDeleteRecord(recordId: number): Promise<void> {
  const res = await fetch(`${BASE}/records/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: recordId }),
  });
  if (!res.ok) throw new Error(`delete record failed: ${res.status}`);
}

// ─── 解决方案快照（挂在采集记录上，一条记录只留最后一次） ──────────────────────

/**
 * 保存解决方案页改过的参数；updatedAt 传本地时间字符串（与 date/time 同款，避免 UTC 错位）。
 * keepalive：解决方案页在 pagehide / 卸载时会补发最后一次，正常 fetch 会随页面一起被掐断；
 * 快照约 1KB，远低于 keepalive 的 64KB 上限。
 */
export async function apiSaveRecordSolution(recordId: number, solution: unknown, updatedAt: string): Promise<void> {
  const res = await fetch(`${BASE}/records/solution`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: recordId, solution, updated_at: updatedAt }),
    keepalive: true,
  });
  if (!res.ok) throw new Error(`save solution failed: ${res.status}`);
}

/** 读回方案快照；该记录从未编辑过方案则返回 null（调用方走默认值路径） */
export async function apiGetRecordSolution<T = unknown>(recordId: number): Promise<T | null> {
  const res = await fetch(`${BASE}/records/${recordId}/solution`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get solution failed: ${res.status}`);
  const data = await res.json();
  return (data.solution ?? null) as T | null;
}

// ─── 鞋壳仓库（元数据进 SQLite，STL 落盘 data/shells/） ────────────────────────
export interface ApiShell {
  id: number;
  label: string;
  filename?: string;
  size?: number;
  /** 手动微调摆位（ShellAdjust 形状）；null = 用默认 */
  adjust?: unknown;
  /** 形态缩略图是否已渲好（刚上传时可能还在后台渲，卡片先显示骨架） */
  hasThumb?: boolean;
}

/** 鞋壳 STL 的下载地址（交给 StlInsoleViewer 的 XHR 带进度地拉） */
export function shellFileUrl(shellId: number): string {
  return `${BASE}/shells/${shellId}/file`;
}

/**
 * 鞋壳形态缩略图（几十 KB 的灰模 PNG，选择抽屉的卡片配图）。
 * 后端没有现成的会当场渲一张再回（约 1s），所以哪怕 hasThumb=false 也能直接给 <img>。
 */
export function shellThumbUrl(shellId: number): string {
  return `${BASE}/shells/${shellId}/thumb`;
}

/** 列出已上传的鞋壳（选择窗口用） */
export async function apiListShells(): Promise<ApiShell[]> {
  const res = await fetch(`${BASE}/shells`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`list shells failed: ${res.status}`);
  const data = await res.json();
  return (data.shells ?? []) as ApiShell[];
}

/**
 * 上传鞋壳：请求体直接是 STL 原始字节，元数据走 query 参数。
 * 不用 FormData/base64——鞋壳动辄几十上百 MB，multipart 要后端装 python-multipart，
 * base64 还会把 83MB 撑到 112MB。超时给足 5 分钟。
 */
export async function apiUploadShell(file: File, label: string): Promise<ApiShell> {
  const qs = `label=${encodeURIComponent(label)}&filename=${encodeURIComponent(file.name)}`;
  const res = await fetch(`${BASE}/shells?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`upload shell failed: ${res.status}`);
  const data = await res.json();
  return data.shell as ApiShell;
}

/** 记住某个鞋壳的手动微调摆位（校正过一次下次直接沿用） */
export async function apiSaveShellAdjust(shellId: number, adjust: unknown): Promise<void> {
  const res = await fetch(`${BASE}/shells/adjust`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: shellId, adjust }),
  });
  if (!res.ok) throw new Error(`save shell adjust failed: ${res.status}`);
}

/** 删除一个鞋壳（连同落盘 STL） */
export async function apiDeleteShell(shellId: number): Promise<void> {
  const res = await fetch(`${BASE}/shells/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: shellId }),
  });
  if (!res.ok) throw new Error(`delete shell failed: ${res.status}`);
}
