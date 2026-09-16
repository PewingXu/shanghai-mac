# 矩侨工业 足底压力分析系统（上海展会版）

React 19 + Vite 前端，FastAPI Python 后端，Electron 桌面壳。
用户站上 64×64 压力足垫采集 30 秒，系统出足弓 / 压力分区 / COP 平衡报告，并生成可下载的 3D 定制鞋垫 STL。

> 本仓库面向 **macOS** 开发与打包。Windows 打包脚本（`release/build-installer.cmd`）也在库里，用法见文末。

---

## 一、macOS 快速开始（从零到跑起来）

### 1. 装 Node.js（唯一需要手动装的东西）

去 <https://nodejs.org> 下载 **LTS** 版安装。装完终端里确认：

```bash
node --version    # v18 以上即可
```

不需要自己装 Python、pnpm、conda，下面的脚本会全部搞定，而且不碰系统环境。

### 2. 克隆仓库

```bash
git clone https://github.com/PewingXu/shanghai-mac.git
cd shanghai-mac
```

仓库约 230 MB（含 3D 鞋垫模型），克隆需要一会儿。

### 3. 一键准备环境

```bash
bash scripts/setup-mac.sh
```

这一步会自动：

| 步骤 | 做了什么 | 放在哪 |
|---|---|---|
| pnpm | 如果没有就安装，然后装前端依赖 | `node_modules/` |
| Python 3.12 | 下载独立运行时（python-build-standalone），按 Mac 芯片自动选 Apple Silicon / Intel | `release/dist-mac/python-rt/` |
| 后端依赖 | 用上面的 Python 按 `requirements.lock.txt` 装 numpy / scipy / OpenCV / FastAPI 等，装完做 import 自检 | 同上 |
| 锁定 | 写 `.aciki-python-lock.json`，让 `pnpm dev` 直接用这个解释器 | 项目根 |

需要联网，首次约 5 到 10 分钟。全部装在项目目录里，删掉目录就是卸载干净。

为什么固定 Python 3.12：后端锁定的 numpy 1.26 / scipy 1.14 只有 3.10 到 3.12 有 macOS 二进制轮子，系统自带的 python3 版本不定，3.13 又没有轮子。

### 4. 启动

```bash
pnpm dev
```

同时起后端（8766）和前端（3000），浏览器打开 <http://127.0.0.1:3000>。Ctrl+C 一起停。

没有足垫也能跑：采集页右上角“导入数据”，选 `samples/sample-standing.csv` 回放一次真实采集，后面报告、方案页都能走通。

### 5. 足垫串口驱动（有设备时才需要）

足垫用 CH343 USB 转串口芯片，macOS 需要装一次驱动：

1. 到沁恒 WCH 官网下载 **CH34x VCP 驱动 macOS 版**并安装。
2. 系统设置 → 隐私与安全性 → 允许该驱动加载，可能需要重启。
3. 插上足垫后终端里 `ls /dev/cu.*` 应出现 `cu.usbserial-xxxx` 或 `cu.wchusbserial-xxxx`。

后端会自动扫描全部串口、用设备码匹配足垫。自动匹配不上时，采集页点“连接设备”会弹出手动选口窗口，选中后可一键把这块足垫登记为默认设备。

---

## 二、打 macOS 安装包

```bash
bash release/build-installer-mac.sh
```

产物在 `release/dist-mac/`：

```
矩侨工业足底压力分析-1.0.0-mac-arm64.dmg    （Intel Mac 上是 -x64）
矩侨工业足底压力分析-1.0.0-mac-arm64.zip
```

脚本做的事：

1. 环境没准备就先跑 `scripts/setup-mac.sh`。
2. `pnpm build` 编译前端到 `dist/public`。
3. 把六个后端 `.py` 复制到 `release/dist-mac/backend`。
4. `electron-builder` 出 dmg。首次会下载 Electron 约 100 MB，已配国内镜像。

安装包里带了什么，装到别的 Mac 上需要什么：

| 在包里 | 不在包里 |
|---|---|
| Python 3.12 运行时 + 全部后端依赖 | CH343 串口驱动（有足垫才需要） |
| 后端源码（`.app/Contents/Resources/backend/*.py`，可直接改热修） | |
| 前端构建产物 + 3D 模型 | |
| Electron 自带浏览器内核 | |

注意事项：

- **芯片架构**：Apple Silicon 上打的包只能在 Apple Silicon 上跑，Intel 同理。展会 Mac 芯片不同就在那台机器上再跑一遍脚本。
- **未签名**：本机构建的 app 直接能开。拷到别的 Mac 首次打开如提示“无法验证开发者”，右键 app → 打开；或终端执行 `xattr -dr com.apple.quarantine /Applications/矩侨工业足底压力分析.app`。
- **端口**：壳固定用 8766。如果 `pnpm dev` 的后端还在跑，先停掉再开安装版，否则会提示“后端服务未能就绪”。
- **日志与数据**：启动日志 `$TMPDIR/juqiao-shell.log`；用户数据在 `~/Library/Application Support/juqiao-plantar-pressure-app/aciki-data/`，重装不丢。

---

## 二·五、打 Windows 安装包（换新电脑从零开始）

### 打包原理（一分钟看懂）

安装包 = Electron 壳 + 三份资源，装到用户电脑后布局如下：

```text
矩侨工业足底压力分析\
  矩侨工业足底压力分析.exe          ← Electron 壳：启动后端、等 /health 就绪、开窗口加载 http://127.0.0.1:8766
  resources\
    python-rt\                      ← 嵌入式 Python 3.12 + requirements.lock.txt 全部依赖 + VC++ 运行库 DLL
    backend\                        ← 六个后端 .py（api_server / db_store / serial_bridge / OneStep_report / stl_thumb / heatmap_renderer）
    public\                         ← 前端构建产物（pnpm build 的 dist/public），由后端经 ACIKI_STATIC_DIR 托管
    app\main.js                     ← 壳的主进程代码
```

**不用 PyInstaller**。参考项目试过，把 anaconda 全家桶打进单文件会卡死；嵌入式 Python 目录直接拷走最稳，而且后端 `.py` 可在安装目录里直接替换热修。

### 第一步：新电脑装工具（只做一次）

| 工具 | 怎么装 | 检查 |
|---|---|---|
| Git | <https://git-scm.com> 默认安装 | `git --version` |
| Node.js 18 或更高 | <https://nodejs.org> 下 LTS 安装 | `node --version` |
| pnpm | 管理员 cmd 里 `corepack enable`；不行就 `npm install -g pnpm@10` | `pnpm --version` |

**不需要**手动装 Python。构建脚本会自己下载嵌入式 Python 放到项目目录里，不碰系统。

### 第二步：拉代码、装前端依赖

```bat
git clone https://github.com/PewingXu/shanghai-mac.git
cd shanghai-mac
pnpm install
```

仓库约 230 MB（含 3D 鞋垫模型），`pnpm install` 首次约 2 到 5 分钟。

### 第三步：一键打包

```bat
release\build-installer.cmd
```

脚本四步，全程自动，首次约 10 到 20 分钟（取决于网速）：

| 步骤 | 做什么 | 首次耗时 | 产物位置 |
|---|---|---|---|
| 1 | `pnpm build` 编译前端 | 10 秒 | `dist\public\` |
| 2 | 下载 python.org 的 embed 包 → 装 pip → 按 `requirements.lock.txt` 装齐 numpy / scipy / OpenCV / FastAPI 等 → 从本机 `System32` 拷 VC++ 运行库 DLL | 5 到 15 分钟 | `release\dist\python-rt\` |
| 3 | 复制六个后端 `.py` | 瞬时 | `release\dist\backend\` |
| 4 | `npm install` 装 electron-builder → 下载 Electron 和 NSIS → 出安装包 | 3 到 5 分钟 | `release\dist\` |

**产物**：

```text
release\dist\矩侨工业足底压力分析-Setup-<版本>.exe    约 275 MB，这就是给别人的安装包
release\dist\win-unpacked\                            解包后的目录版，双击里面的 exe 可直接试运行不用安装
```

版本号取自 `release\electron\package.json` 的 `version` 字段。发新版前把它和根目录 `package.json` 的 `version` 一起改。

**第二次及以后**：步骤 2 和 4 的下载都会跳过（运行时目录已存在、`node_modules` 已存在），整个打包只需 1 到 2 分钟。

### 第四步：本机验证（可选但建议）

先确认 8766 端口没被占用（`pnpm dev` 的后端在跑就先关掉），然后双击：

```text
release\dist\win-unpacked\矩侨工业足底压力分析.exe
```

窗口 3 秒内出现、首页有 Logo 即成功。没起来看 `%TEMP%\juqiao-shell.log`。验证完把 `%APPDATA%\juqiao-plantar-pressure-app` 删掉，免得测试数据带到正式环境。

### 常见失败与处理

| 现象 | 原因 | 处理 |
|---|---|---|
| 步骤 2 卡在下载 embed 包 | python.org 国内慢 | 从有网的机器把 `python-3.12.8-embed-amd64.zip` 下好放到 `release\` 下，脚本会直接用 |
| 步骤 2 pip 装依赖超时 | PyPI 慢 | 先 `set PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple` 再跑脚本 |
| 步骤 4 下载 Electron 失败 | 镜像抽风 | 脚本已配 npmmirror；重跑一次通常就好 |
| 装好后双击提示“后端服务未能就绪” | 8766 被占，或 python-rt 缺 DLL | 看 `%TEMP%\juqiao-shell.log`；缺 DLL 就手动把 `msvcp140.dll` `vcruntime140.dll` `vcruntime140_1.dll` `concrt140.dll` 拷进 `resources\python-rt\` |
| 干净电脑 numpy 报 `DLL load failed` | VC++ 运行库没打进去 | 同上，或让用户装 VC++ 2015-2022 运行库 |
| 打包机上运行时目录是旧的，想重建 | — | 删掉 `release\dist\python-rt\` 再跑脚本 |

### 给用户的安装说明

- Windows 10/11 64 位，双击安装，不需要装 Python 或任何运行环境。
- 首次运行会弹 SmartScreen 蓝色警告（未签名），点“更多信息”再点“仍要运行”。
- 有足垫需装 CH343 串口驱动，多数 Windows 会自动装。
- 自动连不上足垫时，采集页点“连接设备”会弹出选 COM 口的窗口，选中后可登记为默认设备。
- 启动日志 `%TEMP%\juqiao-shell.log`；数据在 `%APPDATA%\juqiao-plantar-pressure-app\aciki-data`，重装不丢。

### 改了代码要不要重打包

| 改了什么 | 要不要重打包 |
|---|---|
| 后端 `.py`（算法、串口、接口） | **不用**。直接替换用户电脑上 `resources\backend\` 里的文件，重开应用即可 |
| 前端（`client/` 下任何文件） | 要 |
| 壳 `release/electron/main.js` | 要 |
| 压强标定公式 `client/src/lib/pressureCalib.ts` | 要（它在前端）。只改 `adcToKpa` 的三个系数；标定工具见 `tools/calibrate_pressure.html` 与 `tools/README-calibration.md` |
| Python 依赖版本 `requirements.lock.txt` | 要，且要先删 `release\dist\python-rt\` 让脚本重建运行时 |

## 三、项目结构

```
client/src/
  pages/Home.tsx          单页状态机：landing → measure → report → solution / history
  pages/MeasurePage.tsx   采集：3D/2D 实时热力图、30s 倒计时、导入回放、手动选口
  pages/ReportPage.tsx    报告：足底尺寸 / 足弓 / 压力面积 / COP（左右脚切换），脚模在上数据在下
  pages/SolutionPage.tsx  方案：标准晶格鞋垫 3D 预览、对比前后、参数调节、STL 导出
  pages/RecordsPage.tsx   体验记录：回看历史报告与方案
  lib/deviceManager.ts    足垫连接（串口桥优先，手动选口兜底，Web Serial 兜底）
  lib/pressureCalib.ts    ADC → kPa 标定公式（采集页压强/总力由此换算）
  lib/pythonApi.ts        调 Python /analyze
tools/calibrate_pressure.html   足垫压力标定工具（配 tools/README-calibration.md）
  components/             BrandLogo、PortPickerModal、StlInsoleViewer、FeetModel3D…
api_server.py             FastAPI：分析 / 用户 / 记录 / 鞋壳 / 设备 接口，打包时兼托管前端
serial_bridge.py          串口桥：扫描 COM 口、AT 校验设备码、WebSocket 推帧、手动选口
OneStep_report.py         核心算法（足弓指数、分区、COP）
db_store.py               SQLite + 落盘（records/<id>.json / .csv，shells/）
scripts/setup-mac.sh      macOS 一键环境
scripts/dev.mjs, lib.mjs  pnpm dev：自动选 Python 解释器并同时起前后端
release/electron/         Electron 壳（main.js）、Win 配置（package.json）、Mac 配置（electron-builder.mac.yml）
release/build-installer-mac.sh   macOS 打包
release/build-installer.cmd      Windows 打包
```

### 数据流

采集页收帧 → 30 秒结束后调 `POST /analyze` → 结果经 `aciki-analysis-done` 事件广播 → 报告页渲染、AppContext 落盘一条记录 → 方案页从同一份分析结果换算鞋垫参数 → 用户改的参数存回该记录的快照。

### 压强与 COP 的口径

- 采集页「压强」：每个有效格（ADC 高于噪声阈值）先按 `pressureCalib.ts` 的标定曲线换成 kPa，Σ kPa×单格面积 = 总力 N，总力 ÷ 双脚接触面积 = 平均压强 kPa。双脚一起算。
- 报告页「COP 平衡指标」：**单脚**指标，后端对左右脚各算一份（`cop_time_series_left / _right`），卡片右上角切换。某脚没踩上则该脚按钮置灰。老记录只有合并字段 `cop_time_series`，它算的是轨迹点数多的那只脚，前端按点数归到对应脚上。

### 设备连接

1. **串口桥**（首选）：后端 `serial_bridge.py` 枚举全部串口，逐个发 `AT+NAME=ESP32` 读设备码，匹配登记码则锁定并持续读帧（4096 字节 + `AA 55 03 99` 分隔符），经 WebSocket 推前端。拔插自动重扫。
2. **手动选口**（桥在跑但没匹配到时）：前端列出串口，用户点一个，后端只开这个口，收到完整帧才算成功；设备码不同可登记为默认（写 `data/device.json`）。
3. **Web Serial**（后端没起时）：浏览器直连已授权串口，同样校验设备码。

设备码优先级：环境变量 `ACIKI_DEVICE_CODE` > `data/device.json` > 代码默认值。

---

## 四、常用命令

```bash
pnpm dev          # 前后端一起起（开发）
pnpm dev:web      # 只起前端
pnpm dev:api      # 只起后端
pnpm build        # 编译前端到 dist/public
pnpm check        # TypeScript 类型检查
bash release/build-installer-mac.sh     # macOS 安装包
```

环境变量（可选）：

| 变量 | 作用 |
|---|---|
| `ACIKI_PYTHON` | 指定后端解释器路径，绕过自动探测 |
| `PYTHON_API_PORT` | 后端端口，默认 8766 |
| `ACIKI_DATA_DIR` | 数据目录，默认 `./data` |
| `ACIKI_DEVICE_CODE` | 覆盖足垫设备码 |

---

## 五、常见问题

**`pnpm dev` 报找不到依赖完整的 Python**
重跑 `bash scripts/setup-mac.sh`；或删掉 `.aciki-python-lock.json` 让它重新扫描。

**报告页显示“演示数据”水印**
后端没起或分析失败，看终端里 `[backend]` 的报错。常见是 8766 被别的进程占着：`lsof -i :8766`。

**方案页 3D 鞋垫加载慢**
标准鞋垫 STL 约 3 MB，首次加载后缓存。舒缓/运动款文件更大但展会版已隐藏。

**安装版打开后白屏或立刻退出**
看 `$TMPDIR/juqiao-shell.log`，里面有后端 stdout/stderr。多数是 8766 被占或 Python 依赖缺失。

**Windows 打包**
在 Windows 上双击 `release/build-installer.cmd`，产物在 `release/dist/`。原理与 Mac 相同，用的是嵌入式 Python 3.12。
