// 共享：解析"能跑后端的 Python 解释器"，并启动 api_server.py
// 关键：永远只挑能 import numpy/pandas/scipy/fastapi/uvicorn 的解释器，
// 避免落到坏的 Python（例如系统默认的 3.14 alpha，numpy DLL 加载失败）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const IMPORT_CHECK = "import numpy,pandas,scipy,fastapi,uvicorn";

function canImport(cmd, args) {
  try {
    const r = spawnSync(cmd, [...args, "-c", IMPORT_CHECK], {
      stdio: "ignore",
      timeout: 30000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** 返回 { cmd, args } 或 null。优先级：ACIKI_PYTHON > 家目录 conda 的 python.exe > conda run -n base > python/py */
export function resolvePython() {
  const home = os.homedir();
  const candidates = [];
  if (process.env.ACIKI_PYTHON) candidates.push({ cmd: process.env.ACIKI_PYTHON, args: [] });
  for (const d of ["anaconda3", "Anaconda3", "miniconda3", "Miniconda3"]) {
    candidates.push({ cmd: path.join(home, d, "python.exe"), args: [] }); // Windows
    candidates.push({ cmd: path.join(home, d, "bin", "python"), args: [] }); // *nix
  }
  for (const c of candidates) {
    const isPath = c.cmd.includes("/") || c.cmd.includes("\\");
    if (isPath && !existsSync(c.cmd)) continue;
    if (canImport(c.cmd, c.args)) return c;
  }
  const condaBase = { cmd: "conda", args: ["run", "--no-capture-output", "-n", "base", "python"] };
  if (canImport(condaBase.cmd, condaBase.args)) return condaBase;
  for (const c of [{ cmd: "python", args: [] }, { cmd: "py", args: [] }]) {
    if (canImport(c.cmd, c.args)) return c;
  }
  return null;
}

/** 启动后端；返回 child_process。找不到可用 Python 时打印指引并退出。 */
export function startBackend() {
  const py = resolvePython();
  if (!py) {
    console.error("[backend] ✗ 找不到能 import numpy/pandas/scipy/fastapi/uvicorn 的 Python。");
    console.error("[backend]   解决：设环境变量 ACIKI_PYTHON 指向可用解释器，");
    console.error("[backend]   或在该环境执行  pip install -r requirements.txt");
    process.exit(1);
  }
  const port = process.env.PYTHON_API_PORT || "8766";
  console.log(`[backend] ✓ python = ${py.cmd} ${py.args.join(" ")}  → http://127.0.0.1:${port}`);
  return spawn(py.cmd, [...py.args, "api_server.py"], {
    env: { ...process.env, PYTHON_API_PORT: port },
    stdio: "inherit",
    windowsHide: true,
  });
}
