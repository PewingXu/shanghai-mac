# -*- coding: utf-8 -*-
"""生成页面背景的透视地面网格 SVG（client/public/assets/icons/perspective-grid.svg）。

用法：python scripts/gen_perspective_grid.py
调格子疏密改下面两个参数后重跑即可：
  BOTTOM_DX —— 底边纵线间距（px，1920 设计稿坐标）
  K0        —— 横线近端密度，近端第一格高 ≈ (H-YH)/(K0+1)

为什么是静态 SVG：网格若做成 fixed+3D transform+mask 的 DOM 层，会触发
Chromium 合成层排序 bug 盖到页面内容上（卡片"透明"假象）。烘成 SVG 后
作为 shell 元素的背景图，物理上永远画在内容之下。渐浅用 SVG 内部
mask 实现（当前方向：顶部清晰、从上往下渐浅；地平线汇聚点处留 6-14%
一小段渐入，避免透视线在消失点挤成一团），无跨元素合成问题。
"""
import os

W, H = 1920, 1080
YH = 60.0           # 消失点高度（地平线，渐隐后该处本就看不见）
VPX = W / 2
K0 = 9.0            # 近端第一格高 ≈ 1020/(9+1) = 102px（对齐旧 CSS 透视版观感）
BOTTOM_DX = 110.0   # 底边纵线间距（旧 CSS 版 40px 格经透视投影后近端约此宽度）
COLOR = "#B4966E"   # rgb(180,150,110)，与方案页网格同色系
OPACITY = 0.30

lines = []

# 横线：k=0 是底边，向上直到间距 < 2.5px（透视地面等距线的标准投影公式）
prev_y = None
k = 0
while True:
    y = YH + (H - YH) * K0 / (K0 + k)
    if prev_y is not None and prev_y - y < 2.5:
        break
    lines.append(f'<line x1="0" y1="{y:.1f}" x2="{W}" y2="{y:.1f}"/>')
    prev_y = y
    k += 1

# 纵线：底边等距点连向消失点，两侧延伸到 3 倍屏宽防超宽屏拉伸后露边
x = VPX
i = 0
while x < 3 * W:
    for xi in ({x} if i == 0 else {x, 2 * VPX - x}):
        lines.append(f'<line x1="{xi:.1f}" y1="{H}" x2="{VPX:.1f}" y2="{YH:.1f}"/>')
    i += 1
    x = VPX + i * BOTTOM_DX

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="none">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.06" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.14" stop-color="#fff" stop-opacity="0.9"/>
      <stop offset="0.62" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="0.96" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="fadeMask">
      <rect x="0" y="0" width="{W}" height="{H}" fill="url(#fade)"/>
    </mask>
  </defs>
  <g stroke="{COLOR}" stroke-width="1.2" opacity="{OPACITY}" mask="url(#fadeMask)">
    {chr(10).join('    ' + l for l in lines)}
  </g>
</svg>
'''

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "client", "public", "assets", "icons", "perspective-grid.svg")
with open(out, "w", encoding="utf-8") as f:
    f.write(svg)
print("lines:", len(lines))
print("written:", os.path.normpath(out))
