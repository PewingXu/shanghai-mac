# ACIKI 动态足底压力解析系统

足底压力采集与分析系统：前端负责界面、采集与可视化，Python 后端负责足弓 / COP / 压力分区等指标计算与报告（PDF + 图）生成。

## 系统组成

| 部分 | 技术 | 作用 |
|---|---|---|
| 前端 | React 19 + Vite + Tailwind | 界面、采集、可视化（端口 3000） |
| 分析后端 | Python + FastAPI | 出报告：指标 + base64 图（端口 8766） |

## 环境要求

- Node.js ≥ 20，pnpm
- Python 3.12（依赖见 `requirements.txt`）

## 启动（开发模式）

需要 **两个终端**：一个跑 Python 后端，一个跑前端。

### 1. 安装前端依赖（仅首次）

```bash
pnpm install
```

### 2. 启动 Python 分析后端（端口 8766）

```bash
# 通用方式：先装依赖（建议在 conda/venv 里，Python 3.12）
pip install -r requirements.txt
python api_server.py
```

```bash
# 本机（已配好 conda 环境）可直接复用，无需再装依赖：
conda run -n xupeirong_win11 --no-capture-output python api_server.py
```

看到 `Uvicorn running on http://127.0.0.1:8766` 即启动成功。

### 3. 启动前端（端口 3000）

```bash
pnpm dev
```

### 4. 打开浏览器

访问 **http://localhost:3000**

> - 前端开发模式会自动把 `/pyapi/*` 代理到后端 `127.0.0.1:8766`（见 `vite.config.ts`）。
> - 验证后端是否就绪：访问 http://127.0.0.1:8766/health ，返回 `{"status":"ok"}` 即正常。

## 构建生产版本

```bash
pnpm build    # 前端 + 服务端打包到 dist/
pnpm start    # 运行生产服务
```

## 目录结构

```
client/                前端
  src/
    pages/             页面
    components/        组件（含 shadcn/ui）
    lib/               pythonApi.ts(调后端) · FootAnalysis.ts(类型/JS回退) · utils.ts
    contexts/ hooks/
server/                Node/Express 入口
shared/                前后端共享常量
api_server.py          Python 分析服务（FastAPI，端口 8766）
OneStep_report.py      核心算法 + 出 PDF 报告
heatmap_renderer.py    热力图渲染
requirements.txt       Python 依赖
PYTHON_BACKEND.md      后端详细说明
```

## 更多说明

- Python 后端的接口、依赖、注意事项详见 **`PYTHON_BACKEND.md`**。
- 本机 Python 环境为 conda 环境 `xupeirong_win11`（Python 3.12，已装齐 seaborn / opencv / fastapi 等）；其它机器按 `requirements.txt` 重建即可。
