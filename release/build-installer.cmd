@echo off
REM 矩侨工业 足底压力分析 安装包一键构建（嵌入式 Python 方案，勿用 PyInstaller——打包 anaconda 全家桶会卡死）
REM 产物：release\dist\矩侨工业足底压力分析-Setup-1.0.0.exe
REM
REM 布局：安装包 = Electron 壳 + resources\{python-rt, backend, public}
REM   python-rt  嵌入式 Python 3.12 + requirements.lock.txt 全部依赖（首次需联网生成，见 [2/4]；
REM              与 aciki-plantar-pressure 的 lock 完全相同，可直接从那边 release\dist\python-rt 拷来复用）
REM   backend    后端源码（改后端只需替换安装目录里的 .py 即可热修，无需重打包）
REM   public     前端构建产物（后端经 ACIKI_STATIC_DIR 单进程托管）
setlocal
set PROJ=%~dp0..
set RT=%~dp0dist\python-rt

echo [1/4] 构建前端 dist/public ...
cd /d "%PROJ%"
call pnpm build || goto :fail

echo [2/4] 准备嵌入式 Python 运行时 ...
if exist "%RT%\python.exe" (
  echo   已存在 %RT%，跳过（要重建请先删掉该目录）
) else (
  curl -L -o "%~dp0python-embed.zip" https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip || goto :fail
  powershell -Command "Expand-Archive '%~dp0python-embed.zip' -DestinationPath '%RT%' -Force" || goto :fail
  powershell -Command "(Get-Content '%RT%\python312._pth') -replace '^#import site', 'import site' | Set-Content '%RT%\python312._pth' -Encoding ascii" || goto :fail
  curl -sL -o "%~dp0get-pip.py" https://bootstrap.pypa.io/get-pip.py || goto :fail
  "%RT%\python.exe" "%~dp0get-pip.py" --no-warn-script-location || goto :fail
  "%RT%\python.exe" -m pip install -r "%PROJ%\requirements.lock.txt" --no-warn-script-location || goto :fail
  del "%~dp0python-embed.zip" "%~dp0get-pip.py"
)
REM VC++ 运行库必须随包带上：numpy/OpenCV 的 .pyd 依赖 msvcp140/concrt140，
REM 开发机 System32 里有所以本机测不出来；干净电脑缺它们 → import 即崩 →
REM 用户看到"后端服务已停止"弹窗。从本机 System32 拷（构建机必然有）。
for %%d in (msvcp140.dll msvcp140_1.dll msvcp140_2.dll concrt140.dll vcomp140.dll vcruntime140.dll vcruntime140_1.dll) do (
  if exist "%SystemRoot%\System32\%%d" copy /y "%SystemRoot%\System32\%%d" "%RT%\" >nul
)

echo [3/4] 收集后端源码 ...
if not exist "%~dp0dist\backend" mkdir "%~dp0dist\backend"
copy /y "%PROJ%\api_server.py" "%~dp0dist\backend\" >nul
copy /y "%PROJ%\db_store.py" "%~dp0dist\backend\" >nul
copy /y "%PROJ%\serial_bridge.py" "%~dp0dist\backend\" >nul
copy /y "%PROJ%\OneStep_report.py" "%~dp0dist\backend\" >nul
copy /y "%PROJ%\stl_thumb.py" "%~dp0dist\backend\" >nul
copy /y "%PROJ%\heatmap_renderer.py" "%~dp0dist\backend\" >nul

echo [4/4] electron-builder 出安装包 ...
cd /d "%~dp0electron"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
if not exist node_modules call npm install --no-audit --no-fund || goto :fail
call npx electron-builder --win nsis || goto :fail

echo.
echo 构建完成：release\dist\*.exe
exit /b 0
:fail
echo 构建失败（退出码 %errorlevel%）
exit /b 1
