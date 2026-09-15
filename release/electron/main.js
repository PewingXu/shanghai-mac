// Electron 主进程：用内置的嵌入式 Python 运行时启动后端（单进程服务 API+前端），
// 等 /health 就绪后打开窗口加载 http://127.0.0.1:8766。关窗即退出（后端随之结束）。
//
// 打包布局（resources/ 下）：
//   python-rt/   嵌入式 Python 3.12 + 全部依赖（requirements.lock.txt）
//   backend/     后端源码（api_server.py 等；改后端只需替换这里的 .py，无需重打包）
//   public/      前端构建产物（后端经 ACIKI_STATIC_DIR 托管）
// 数据写入 %APPDATA%/<app>/aciki-data（Program Files 不可写，且重装不丢数据）。
const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

// 打包后的 GUI 应用没有控制台，所有诊断信息落盘：
//   Windows %TEMP%\juqiao-shell.log   macOS $TMPDIR/juqiao-shell.log
const LOG_FILE = path.join(require("os").tmpdir(), "juqiao-shell.log");
function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* 日志失败不影响运行 */
  }
}
process.on("uncaughtException", (err) => {
  log(`UNCAUGHT: ${err.stack || err}`);
});

const API_PORT = 8766;
// Windows：嵌入式 Python（python.exe 在根目录）；
// macOS：python-build-standalone（bin/python3.12 是真文件，bin/python3 是符号链接——
//        打包拷贝时符号链接可能丢，所以优先找真文件）
const RT_DIR = path.join(process.resourcesPath, "python-rt");
const PY_EXE =
  process.platform === "win32"
    ? path.join(RT_DIR, "python.exe")
    : ["python3.12", "python3", "python"].map((n) => path.join(RT_DIR, "bin", n)).find((p) => fs.existsSync(p)) ||
      path.join(RT_DIR, "bin", "python3");
const BACKEND_DIR = path.join(process.resourcesPath, "backend");
const STATIC_DIR = path.join(process.resourcesPath, "public");
const DATA_DIR = path.join(app.getPath("userData"), "aciki-data");

let backend = null;
let window = null;
let quitting = false;

// 同一台机器只允许一个实例：两个实例会抢 8766 端口和同一个串口
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

function waitForHealth(retries = 120, delayMs = 500) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      if (n <= 0) return reject(new Error("backend health check timed out"));
      const req = http.get(
        { host: "127.0.0.1", port: API_PORT, path: "/health", timeout: 800 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          setTimeout(() => attempt(n - 1), delayMs);
        }
      );
      req.on("error", () => setTimeout(() => attempt(n - 1), delayMs));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(() => attempt(n - 1), delayMs);
      });
    };
    attempt(retries);
  });
}

function startBackend() {
  backend = spawn(PY_EXE, [path.join(BACKEND_DIR, "api_server.py")], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PYTHON_API_PORT: String(API_PORT),
      ACIKI_DATA_DIR: DATA_DIR,
      ACIKI_STATIC_DIR: STATIC_DIR,
      PYTHONIOENCODING: "utf-8", // 后端打印含中文/emoji，防 GBK 编码崩
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backend.stdout.on("data", (d) => log(`[backend] ${String(d).trimEnd()}`));
  backend.stderr.on("data", (d) => log(`[backend:err] ${String(d).trimEnd()}`));
  backend.on("error", (err) => log(`[backend] spawn error: ${err.stack || err}`));
  backend.on("exit", (code) => {
    log(`[backend] exited code=${code} quitting=${quitting}`);
    backend = null;
    // 后端意外退出（非应用关闭流程）→ 提示后退出，避免白屏挂死
    if (!quitting) {
      dialog.showErrorBox(
        "后端服务已停止",
        `后端进程意外退出（代码 ${code}）。请重新打开应用；若反复出现请联系技术支持。\n日志：${LOG_FILE}`
      );
      app.quit();
    }
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });
  window.on("closed", () => (window = null));
  window.loadURL(`http://127.0.0.1:${API_PORT}/`);
}

app.whenReady().then(() => {
  log(`shell start: PY_EXE=${PY_EXE} exists=${fs.existsSync(PY_EXE)}`);
  log(`BACKEND_DIR=${BACKEND_DIR} exists=${fs.existsSync(path.join(BACKEND_DIR, "api_server.py"))}`);
  log(`STATIC_DIR=${STATIC_DIR} exists=${fs.existsSync(path.join(STATIC_DIR, "index.html"))}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  startBackend();
  waitForHealth()
    .then(() => {
      log("health OK, opening window");
      createWindow();
    })
    .catch((err) => {
      log(`health FAILED: ${err.message}`);
      dialog.showErrorBox(
        "启动失败",
        `后端服务未能就绪：${err.message}\n请重试；若反复出现请联系技术支持。\n日志：${LOG_FILE}`
      );
      app.quit();
    });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  if (backend) backend.kill();
});
