@echo off
rem ───────────────────────────────────────────────────────────────────────────
rem ACIKI Python 后端启动脚本（生产 / 打包发布用）
rem
rem 解释器选择优先级（与 scripts/lib.mjs 的锁定机制一致）：
rem   1. 环境变量 ACIKI_PYTHON（换机部署时设置一次即可）
rem   2. 本机锁定环境 %USERPROFILE%\anaconda3\python.exe
rem 依赖版本见 requirements.lock.txt（部署新机先 pip install -r 它）。
rem ───────────────────────────────────────────────────────────────────────────
setlocal

cd /d "%~dp0"

set "PY=%ACIKI_PYTHON%"
if "%PY%"=="" set "PY=%USERPROFILE%\anaconda3\python.exe"

if not exist "%PY%" (
  echo [backend] 找不到 Python 解释器: %PY%
  echo [backend] 请设置环境变量 ACIKI_PYTHON 指向已安装 requirements.lock.txt 依赖的解释器
  exit /b 1
)

if "%PYTHON_API_PORT%"=="" set "PYTHON_API_PORT=8766"

echo [backend] python = %PY%  --^> http://127.0.0.1:%PYTHON_API_PORT%
"%PY%" api_server.py
