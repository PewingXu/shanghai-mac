# Python 分析后端（出报告根基）

本目录的 Python 后端从原型项目 `huisheng-system` 原样搬入，负责足底压力的核心计算与报告生成，
**使用逻辑与 huisheng-system 完全一致**。

## 文件清单

| 文件 | 作用 |
|---|---|
| `OneStep_report.py` | 核心算法：预处理、足弓指标(Clarke/Staheli)、COP 轨迹、压力分区、熵/摆动；`create_pdf_report()` 出多页 PDF |
| `heatmap_renderer.py` | 足压热力图 PNG 渲染（被 OneStep 调用 `generate_heatmap_png`） |
| `api_server.py` | FastAPI 服务，封装上面算法为 HTTP 接口（默认端口 **8766**） |
| `client/src/lib/pythonApi.ts` | 前端调用封装（`checkPythonBackend` / `analyzePython` / `convertPythonResult`） |
| `client/src/lib/FootAnalysis.ts` | 前端类型与 JS 回退算法（pythonApi 依赖其类型，零外部依赖） |

## 启动

### 本机（推荐：直接复用 huisheng 当初的 conda 环境，无需安装任何依赖）

huisheng-system 用的就是本机 conda 环境 **`xupeirong_win11`**（Python 3.12，已装齐
seaborn / opencv(cv2) / matplotlib / scipy / pandas / numpy / fastapi / uvicorn / pydantic / playwright，
**已实测可直接加载本目录的 `api_server.py`**）。aciki 与 huisheng 同机，直接复用即可：

```bash
conda run -n xupeirong_win11 python api_server.py
# 或：conda activate xupeirong_win11 && python api_server.py
# 默认端口 8766，可用环境变量 PYTHON_API_PORT 覆盖
```

> ⚠️ PATH 里默认的 `D:\Python314`（Python 3.14 alpha）**缺 seaborn，不能直接用**。

### 其它机器 / 重建环境

```bash
pip install -r requirements.txt
python api_server.py
```

前端开发模式下，`vite.config.ts` 已配置代理：`/pyapi/*  ->  http://127.0.0.1:8766/*`。

## 接口

- `GET  /health`  —— 健康检查，返回 `{ "status": "ok" }`
- `POST /analyze` —— 入参 `{ frames: number[][], fps, threshold_ratio }`，返回分析指标 + base64 图
- `POST /analyze-csv` —— CSV 文本入参

## 前端调用方式（与 huisheng 一致）

```ts
import { checkPythonBackend, analyzePython, convertPythonResult } from "@/lib/pythonApi";

if (await checkPythonBackend()) {
  const result = await analyzePython(frames);      // frames: 每帧 4096 值的二维数组
  const report = convertPythonResult(result.data); // -> FootReport
}
```

## 注意事项

- 本机请用 conda 环境 `xupeirong_win11` 启动（已装齐依赖含 seaborn 与 cv2，已实测可加载 `api_server.py`）；不要用 PATH 默认的 `D:\Python314`(3.14a)，它缺 seaborn。
- conda 安装的 opencv 包名不是 `opencv-python`，所以 `pip list` 里看不到该名，但 `import cv2` 正常可用——属预期现象。
- `OneStep_report.py` 里 `import OneStep_template` 为**可选**的“精美模板报告”分支，已用 `try/except` 兜底，缺失不影响 `/analyze` 主链路（huisheng 同样未带该文件）。
- 本次仅搬入“根基设施”，**尚未将 aciki 新 UI 的页面接到该后端**（采集数据流 / ReportPage 调用为后续步骤）。
