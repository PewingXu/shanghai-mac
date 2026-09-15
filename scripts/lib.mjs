// 共享：解析"能跑后端的 Python 解释器"，并启动 api_server.py
// 关键设计（防环境漂移，勿删）：
//   1. IMPORT_CHECK 覆盖后端全链路依赖 —— 不止 fastapi/numpy 五件套，还包括
//      cv2（OneStep_report 顶部硬依赖，缺了整个分析崩掉只剩兜底 demo）、
//      matplotlib/seaborn（出图）、serial（串口桥）。系统里 D:\Python314 之类
//      "半吊子"解释器五件套齐全但缺 cv2，曾多次被误选导致报告页回退演示数据。
//   2. 首次解析成功即写入锁定文件 .aciki-python-lock.json，之后每次启动直接
//      使用锁定的解释器（仍校验依赖，失败才重新扫描）——环境一旦锁定不再漂移。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_FILE = path.join(ROOT, ".aciki-python-lock.json");

// 后端全链路依赖：分析（numpy/pandas/scipy/cv2）+ 出图（matplotlib/seaborn）
// + 服务（fastapi/uvicorn）+ 串口桥（serial）
const IMPORT_CHECK = "import numpy,pandas,scipy,cv2,matplotlib,seaborn,fastapi,uvicorn,serial";

function canImport(cmd, args) {
  try {
    const r = spawnSync(cmd, [...args, "-c", IMPORT_CHECK], {
      stdio: "ignore",
      timeout: 60000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function readLock() {
  try {
    const data = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
    if (data && typeof data.cmd === "string" && Array.isArray(data.args)) return data;
  } catch {
    /* 无锁定文件或损坏：走扫描 */
  }
  return null;
}

function writeLock(py) {
  try {
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ cmd: py.cmd, args: py.args, lockedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  } catch {
    /* 写不进就每次扫描，不影响功能 */
  }
}

/**
 * 返回 { cmd, args } 或 null。
 * 优先级：锁定文件 > ACIKI_PYTHON > 家目录 conda 的 python.exe > conda run -n base > python/py。
 * 任何来源都必须通过 IMPORT_CHECK 全依赖校验才会被采用；采用即写锁定文件。
 */
export function resolvePython() {
  // 0) 锁定的解释器：路径还在就直接用，不再做 import 校验——
  //    系统冷启动时 anaconda 首次 import cv2/scipy 全家桶可能超过 60s，
  //    校验超时会误判"锁定失效"导致重扫漂移/启动失败。api_server 自身 import
  //    全部依赖，就是最真实的校验：真坏了它会立刻退出，startBackend 里会清锁重扫。
  const locked = readLock();
  if (locked) {
    const isPath = locked.cmd.includes("/") || locked.cmd.includes("\\");
    if (!isPath || existsSync(locked.cmd)) {
      return locked;
    }
    console.warn(`[backend] 锁定的 Python 路径已不存在（${locked.cmd}），重新扫描…`);
  }

  const home = os.homedir();
  const candidates = [];
  if (process.env.ACIKI_PYTHON) candidates.push({ cmd: process.env.ACIKI_PYTHON, args: [] });
  // macOS：scripts/setup-mac.sh 准备的独立运行时（开发与打包共用），优先于系统 Python
  candidates.push({ cmd: path.join(ROOT, "release", "dist-mac", "python-rt", "bin", "python3"), args: [] });
  for (const d of ["anaconda3", "Anaconda3", "miniconda3", "Miniconda3"]) {
    candidates.push({ cmd: path.join(home, d, "python.exe"), args: [] }); // Windows
    candidates.push({ cmd: path.join(home, d, "bin", "python"), args: [] }); // *nix
  }
  candidates.push({ cmd: "conda", args: ["run", "--no-capture-output", "-n", "base", "python"] });
  candidates.push({ cmd: "python3.12", args: [] });
  candidates.push({ cmd: "python3", args: [] });
  candidates.push({ cmd: "python", args: [] });
  candidates.push({ cmd: "py", args: [] });

  for (const c of candidates) {
    const isPath = c.cmd.includes("/") || c.cmd.includes("\\");
    if (isPath && !existsSync(c.cmd)) continue;
    if (canImport(c.cmd, c.args)) {
      writeLock(c); // 锁定：下次启动直接用，不再挑来挑去
      return c;
    }
  }
  return null;
}

/** 启动后端；返回 child_process。找不到可用 Python 时打印指引并退出。 */
export function startBackend() {
  const py = resolvePython();
  if (!py) {
    console.error("[backend] ✗ 找不到依赖完整的 Python（需能 import：numpy/pandas/scipy/cv2/matplotlib/seaborn/fastapi/uvicorn/serial）。");
    console.error("[backend]   解决：在目标环境执行  pip install -r requirements.txt");
    console.error("[backend]   或设环境变量 ACIKI_PYTHON 指向该解释器后重跑 pnpm dev");
    process.exit(1);
  }
  const port = process.env.PYTHON_API_PORT || "8766";
  console.log(`[backend] ✓ python = ${py.cmd} ${py.args.join(" ")}  → http://127.0.0.1:${port}（已锁定，见 .aciki-python-lock.json）`);
  const child = spawn(py.cmd, [...py.args, "api_server.py"], {
    env: { ...process.env, PYTHON_API_PORT: port },
    stdio: "inherit",
    windowsHide: true,
  });
  // 后端在启动早期非正常退出（缺依赖/解释器坏了/端口占用）→ 清除锁定，
  // 下次启动重新扫描环境，避免一直卡在坏锁上。
  const startedAt = Date.now();
  child.on("exit", (code) => {
    if (code !== 0 && Date.now() - startedAt < 30000) {
      try {
        unlinkSync(LOCK_FILE);
        console.error("[backend] 启动即退出，已清除 Python 锁定；请排查上方报错后重跑 pnpm dev（将重新扫描环境）");
      } catch {
        /* 锁不存在则忽略 */
      }
    }
  });
  return child;
}
