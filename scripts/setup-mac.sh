#!/usr/bin/env bash
# macOS 一键准备开发/运行环境：
#   1) pnpm 依赖（前端 + 启动脚本）
#   2) 独立的 Python 3.12 运行时（python-build-standalone，放在 release/dist-mac/python-rt，
#      不碰系统 Python / Homebrew），并按 requirements.lock.txt 装齐全部后端依赖
#   3) 写 .aciki-python-lock.json，之后 `pnpm dev` 直接用这个解释器
#
# 这份运行时同时就是 macOS 安装包里要带走的 resources/python-rt，开发与打包共用一套。
#
# 前置：Node.js 18+（https://nodejs.org 装 LTS）。其余全自动，需联网，首次约 5~10 分钟。
# 用法：bash scripts/setup-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RT="$ROOT/release/dist-mac/python-rt"

[ "$(uname -s)" = "Darwin" ] || { echo "✗ 本脚本只用于 macOS"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ 未找到 Node.js，请先到 https://nodejs.org 安装 LTS 版本后重试"; exit 1; }
echo "✓ node $(node --version)"

# ── 1) pnpm 与前端依赖 ────────────────────────────────────────────────────────
if ! command -v pnpm >/dev/null 2>&1; then
  echo "· 安装 pnpm…"
  (corepack enable && corepack prepare pnpm@10.4.1 --activate) 2>/dev/null || npm install -g pnpm@10
fi
echo "✓ pnpm $(pnpm --version)"
cd "$ROOT"
pnpm install --frozen-lockfile

# ── 2) Python 3.12 独立运行时 ─────────────────────────────────────────────────
# 后端依赖锁在 numpy 1.26 / scipy 1.14，只有 Python 3.10~3.12 有对应二进制轮子；
# macOS 自带的 python3 版本不定（常见 3.9），Python 3.13 又没轮子，所以固定用 3.12 独立运行时。
case "$(uname -m)" in
  arm64)  PBS_TRIPLE="aarch64-apple-darwin" ;;
  x86_64) PBS_TRIPLE="x86_64-apple-darwin" ;;
  *) echo "✗ 不支持的架构 $(uname -m)"; exit 1 ;;
esac
PBS_TAG="${PBS_TAG:-20241016}"
PBS_VER="${PBS_VER:-3.12.7}"
PBS_URL="${PBS_URL:-https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_VER}+${PBS_TAG}-${PBS_TRIPLE}-install_only.tar.gz}"

if [ -x "$RT/bin/python3" ]; then
  echo "✓ 已有 Python 运行时：$RT（要重建请先 rm -rf 该目录）"
else
  echo "· 下载 Python ${PBS_VER}（${PBS_TRIPLE}）…"
  TMP="$(mktemp -d)"
  curl -L --fail --progress-bar -o "$TMP/python.tgz" "$PBS_URL"
  mkdir -p "$TMP/x" && tar -xzf "$TMP/python.tgz" -C "$TMP/x"
  mkdir -p "$(dirname "$RT")" && rm -rf "$RT" && mv "$TMP/x/python" "$RT"
  rm -rf "$TMP"
fi
PY="$RT/bin/python3"
echo "✓ $("$PY" --version)"

echo "· 安装后端依赖（requirements.lock.txt）…"
"$PY" -m pip install --upgrade pip --quiet
"$PY" -m pip install -r "$ROOT/requirements.lock.txt"
"$PY" -c "import numpy,pandas,scipy,cv2,matplotlib,seaborn,fastapi,uvicorn,serial,websockets; print('✓ 后端依赖自检通过')"

# ── 3) 锁定解释器，pnpm dev 直接用 ───────────────────────────────────────────
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({cmd: process.argv[2], args: [], lockedAt: new Date().toISOString()}, null, 2))" \
  "$ROOT/.aciki-python-lock.json" "$PY"
echo "✓ 已锁定 Python 解释器：$PY"

cat <<EOF

全部就绪。
  启动开发环境：  pnpm dev        → 浏览器打开 http://127.0.0.1:3000
  打 macOS 安装包：bash release/build-installer-mac.sh
EOF
