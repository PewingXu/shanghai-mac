#!/usr/bin/env bash
# macOS 安装包一键构建（嵌入式 Python 方案，与 Windows 的 build-installer.cmd 同一套思路）
# 产物：release/dist-mac/矩侨工业足底压力分析-1.0.0-mac-<arch>.dmg（以及同名 .zip）
#
# 布局：安装包 = Electron 壳 + Contents/Resources/{python-rt, backend, public}
#   python-rt  独立 Python 3.12 + requirements.lock.txt 全部依赖（由 scripts/setup-mac.sh 准备，开发与打包共用）
#   backend    后端源码（改后端只需替换 .app 里的 .py 即可热修，无需重打包）
#   public     前端构建产物（后端经 ACIKI_STATIC_DIR 单进程托管）
#
# 只能在 macOS 上运行；打出来的包只适用于同一芯片架构（Apple Silicon / Intel）的 Mac。
# 用法：bash release/build-installer-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/release/dist-mac"
RT="$OUT/python-rt"

[ "$(uname -s)" = "Darwin" ] || { echo "✗ macOS 安装包只能在 macOS 上构建"; exit 1; }
case "$(uname -m)" in arm64) EB_ARCH="--arm64" ;; x86_64) EB_ARCH="--x64" ;; *) echo "✗ 不支持的架构"; exit 1 ;; esac

echo "[1/4] Python 运行时 + 前端依赖 ..."
if [ -x "$RT/bin/python3" ] && [ -d "$ROOT/node_modules" ]; then
  echo "  已就绪（$RT）"
else
  bash "$ROOT/scripts/setup-mac.sh"
fi

echo "[2/4] 构建前端 dist/public ..."
cd "$ROOT"
pnpm build

echo "[3/4] 收集后端源码 ..."
mkdir -p "$OUT/backend"
for f in api_server.py db_store.py serial_bridge.py OneStep_report.py stl_thumb.py heatmap_renderer.py; do
  cp "$ROOT/$f" "$OUT/backend/"
done
# 运行时里开发期跑出来的缓存不带进包
find "$RT" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true

echo "[4/4] electron-builder 出 dmg ..."
cd "$ROOT/release/electron"
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
export CSC_IDENTITY_AUTO_DISCOVERY=false   # 不签名
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --mac $EB_ARCH --config electron-builder.mac.yml

echo
echo "构建完成："
ls -1 "$OUT"/*.dmg "$OUT"/*.zip 2>/dev/null || true
echo
echo "安装：双击 dmg，把 app 拖进「应用程序」。首次打开若提示无法验证开发者，右键 app → 打开。"
echo "日志：\$TMPDIR/juqiao-shell.log   数据：~/Library/Application Support/juqiao-plantar-pressure-app/aciki-data"
