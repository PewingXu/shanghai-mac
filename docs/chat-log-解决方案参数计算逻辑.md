# 聊天记录 — 解决方案参数计算逻辑


- 日期：2026/07/18
- 项目：D:\JOB\projects\2_huisheng\ACIKI-huisheng
- 主题：解决方案（SolutionPage）各参数的计算逻辑

---

## 用户提问 1

> 读取 D:\JOB\projects\2_huisheng\ACIKI-huisheng 项目，解决方案部分各个参数的计算逻辑是什么

## 回答摘要

核心逻辑集中在三个文件：
- `client/src/lib/insoleLogic.ts`（纯计算函数）
- `client/src/lib/solutionData.ts`（数据装配）
- `client/src/lib/insoleSize.ts`（鞋码/足宽换算表）
- `client/src/lib/FootAnalysis.ts`（上游分析：足弓指数、压力占比）

### 数据流总览
分析报告 `FootReport` → `footSolutionFromReport()` 逐脚转换 → `FootSolution` → 页面展示/可编辑。
数据来源分两条：有采集帧 → Python/前端分析结果；无采集帧 → 演示默认值（成人男 44 码）。

### 各参数计算逻辑

**1. 足弓等级 / 类型 / 矫正厚度（archLevel / archType / archCorrection）**
- 上游足弓指数：`AI = 中足面积 / (前足 + 中足 + 后足面积)`（不含脚趾区）— FootAnalysis.ts:542
- `getArchLevelFromAI()` 按 AI 阈值分 7 级：

| AI 范围 | 等级 | 类型 | 矫正厚度 |
|---|---|---|---|
| ≤0.10 | L1 | 重度高弓足 | 10.0mm |
| ≤0.15 | L2 | 中度高弓足 | 8.0mm |
| ≤0.20 | L3 | 轻度高弓足 | 6.0mm |
| ≤0.26 | L4 | 正常足 | 2.5mm |
| ≤0.31 | L5 | 轻度扁平足 | 4.0mm |
| ≤0.36 | L6 | 中度扁平足 | 6.0mm |
| >0.36 | L7 | 重度扁平足 | 8.0mm |

> 注意：解决方案页用的是 `getArchLevelFromAI` 的 correction，而非 `getArchCorrectionFromLevel()`（后者数值不同、未被使用）。

**2. 基础厚度（baseThickness，压力自适应）** — calculatePressureAdaptiveThickness()
```
deviation = 该脚压力占比 - 0.5
maxAdjust  = 0.3 × 0.4 = 0.12cm       // 基厚的 40%
thickness  = 0.3 + deviation × maxAdjust × 2
clamp 到 [0.15cm, 0.6cm]（1.5mm ~ 6mm）
```
压力占比越大 → 基础厚度越厚。压力占比来自 FootAnalysis.ts:1010：`leftPressure / totalPressure × 100`。

**3. 足跟缓冲厚度（heelThickness）** — 按等级查表（V 形）
`{ L1:25, L2:20, L3:15, L4:10, L5:15, L6:20, L7:25 } mm`

**4. 鞋垫软硬 / 整垫硬度（hardness，Shore A）**
- `getZoneHardness()` 查前掌/足弓/后跟三区硬度表
- `getInsoleHardness()` = round((前掌+足弓+后跟)/3)
- 例：L4 正常足 = round((38+42+40)/3) = 40 Shore A

**5. 足长 / 足宽（footLength / footWidth）** — 统一转 cm 并 0.5 步进
```
footLength = round((原值>50 ? 原值/10 : 原值) × 2) / 2
footWidth  同理
```

**6. 匹配鞋码 / 足宽回退（shoeSize）** — lookupInsoleSize()，固定 adult_male
- 表内取足长最近条目；表外公式回退：
```
中国码 = round(足长cm × 2 - 10)
足宽   = 足长cm × 10 × 系数 × 10 /10   // 成人 0.038，青少年 0.058
```
- 用户手填鞋垫长度时用手填值实时换算（SolutionPage.tsx:669）。

**7. 晶格密度（latticeDensity）** — 固定为 3，未参与自适应。

### 编辑态可调范围（滑块）
| 参数 | 范围 | 步进 |
|---|---|---|
| 基础厚度 | 1.5 ~ 6.0mm | 0.1 |
| 足弓矫正厚度 | +1 ~ +12mm | 0.1 |
| 足跟缓冲厚度 | 0 ~ 30mm | 1 |
| 鞋垫软硬 | 20 ~ 60 Shore A | 1 |

3D 顶面隆起量 = 当前值 − 系统默认值（toDeform()），驱动 STL 导出几何变形。

### 重要提示
`loadSolution()` 在页面里是无参调用（SolutionPage.tsx:635），当前始终走演示默认值分支；要启用真实后端结果，需把采集 `frames` 传入 `loadSolution(frames)`。
