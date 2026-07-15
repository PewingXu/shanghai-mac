// 一条命令同时起「Python 后端 + Vite 前端」。用法：pnpm dev
// 重启电脑后只要再跑 pnpm dev，后端会自动用可用的 Python 环境拉起，不再回退 demo。
import { spawn } from "node:child_process";
import { startBackend } from "./lib.mjs";

const backend = startBackend();

// 直接用 node 跑 vite 入口（不经 .cmd/shell，Ctrl+C 时能干净结束，不留孤儿进程）
const web = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "3000"], {
  stdio: "inherit",
  windowsHide: true,
});

const procs = [backend, web];
let quitting = false;
function killAll() {
  if (quitting) return;
  quitting = true;
  for (const p of procs) {
    try {
      p.kill();
    } catch {}
  }
}
process.on("SIGINT", () => {
  killAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  killAll();
  process.exit(0);
});
web.on("exit", (code) => {
  console.log(`[web] 退出 (code ${code})`);
  killAll();
  process.exit(code ?? 0);
});
backend.on("exit", (code) => {
  console.log(`[backend] 退出 (code ${code})——前端仍在运行；分区/COP 将回退 demo。`);
});
