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
