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
}

/** 列出某用户的全部采集记录（按时间倒序，仅元数据） */
export async function apiListRecords(userId: number): Promise<ApiRecord[]> {
  const res = await fetch(`${BASE}/users/${userId}/records`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`list records failed: ${res.status}`);
  const data = await res.json();
  return ((data.records ?? []) as Array<{ id: number; user_id: number; date: string; time: string }>).map((r) => ({
    id: r.id,
    userId: r.user_id,
    date: r.date,
    time: r.time,
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
