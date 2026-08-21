import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 用户 ID 展示格式：自增 id 补零 5 位（1 → "00001"）；过 99999 顺延原样（100000 → "100000"） */
export function formatUserId(id: number | string | undefined | null): string {
  if (id == null) return "—";
  return String(id).padStart(5, "0");
}

/** 手机号脱敏展示：中间 4 位打码（11 位手机 → "131****0094"）；过短原样返回 */
export function maskPhone(phone?: string | null): string {
  const p = (phone ?? "").replace(/\D/g, "");
  if (!p) return "";
  if (p.length < 8) return p;
  // 尾 4 保留（支持尾号搜索比对），中间 4 位打码，其余前缀保留
  return `${p.slice(0, p.length - 8)}****${p.slice(-4)}`;
}

/** 邮箱脱敏展示：账号部分保留首尾、中间打码（"13192830094@qq.com" → "131****094@qq.com"） */
export function maskEmail(email?: string | null): string {
  const e = (email ?? "").trim();
  if (!e || !e.includes("@")) return e;
  const [local, domain] = e.split("@");
  if (local.length <= 3) return `${local[0] ?? ""}***@${domain}`;
  const head = local.slice(0, 3);
  const tail = local.length > 7 ? local.slice(-3) : "";
  return `${head}****${tail}@${domain}`;
}

/** 用户是否命中搜索词：姓名 / ID（含补零形式）/ 手机号片段（天然支持尾号四位） */
export function userMatchesQuery(
  u: { name: string; id: number; phone?: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (u.name.toLowerCase().includes(q)) return true;
  if (String(u.id).includes(q) || formatUserId(u.id).includes(q)) return true;
  // 手机号只按【尾号】匹配（需求：搜尾 4 位；endsWith 天然兼容输入完整号码），
  // 前四位/中间片段不命中——脱敏展示下用户能看到的只有尾 4 位
  const digits = q.replace(/\D/g, "");
  if (digits && (u.phone ?? "").replace(/\D/g, "").endsWith(digits)) return true;
  return false;
}

/** 由生日算年龄（无生日/无效返回 null） */
export function computeAge(birth?: string): number | null {
  if (!birth) return null;
  const d = new Date(birth);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 200 ? age : null;
}
