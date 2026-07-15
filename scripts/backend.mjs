// 只启动 Python 后端（自动选可用解释器）。用法：node scripts/backend.mjs  或  pnpm dev:api
import { startBackend } from "./lib.mjs";

const child = startBackend();
const bye = () => {
  try {
    child.kill();
  } catch {}
};
process.on("SIGINT", () => {
  bye();
  process.exit(0);
});
process.on("SIGTERM", () => {
  bye();
  process.exit(0);
});
child.on("exit", (code) => process.exit(code ?? 0));
