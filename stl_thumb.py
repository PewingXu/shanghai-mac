"""
STL → 灰模缩略图 PNG（鞋壳选择抽屉的卡片配图）

为什么在后端渲染：鞋壳单件 50~84MB，前端要给每张卡片渲一张图就得把每个文件都下载 + 解析一遍，
打开抽屉必然卡死几秒。后端渲一次落盘 data/shells/<id>.png，浏览器只拉几十 KB 的图。

只用 numpy + stdlib（zlib 手写 PNG）—— 本机虽然有 PIL，但 requirements.txt 里没有它，
不给部署环境加隐性依赖。

视角**不依赖 STL 原始摆位**：上传件怎么摆的都有，所以按包围盒三轴跨度定屏幕轴
（最长→横，最短→上，中间→深度），再固定俯仰 + 偏转出一个 3/4 视角。
这一条与前端 shoeShell.autoOrientMatrix 不是同一套判据（那边要精确恢复规范姿态供装配用），
缩略图只求「一眼看出是哪一款」，用包围盒足够，且绝不会因为判错上下把图渲反。

光栅用「深度排序点喷绘」而不是三角形扫描线：每三角取 7 个采样点（3 顶点 + 3 边中点 + 重心），
按深度从远到近排序后散射赋值，后写覆盖先写 ⇒ 近的赢。之后补一到三轮邻域填洞
（面数少的件点稀，不填会满屏麻点），最后 3 倍超采样 3×3 盒式降采样抗锯齿。

CLI：python stl_thumb.py <in.stl> <out.png>
"""

from __future__ import annotations

import math
import os
import re
import struct
import sys
import zlib

import numpy as np

# 输出尺寸（卡片缩略图区 152×96，给 2 倍屏留余量）
OUT_W, OUT_H = 304, 192
# 超采样倍数：点喷绘靠它填洞 + 抗锯齿
SS = 3
# 缩略图只看形状不看精度，抽样上限（前端 shoeShell.ANALYSIS_MAX_TRI 同一思路）
MAX_TRI = 800_000
# 填洞轮数上限：点稀的低模件多填几轮，每轮把轮廓外扩 1 个超采样像素（= 1/3 输出像素）
MAX_FILL = 3
# 画面留白比例
MARGIN = 0.06
# 鞋壳本色：与主视图 StlInsoleViewer.SHELL_COLOR 同一个中性冷灰
BASE_RGB = (0xAE, 0xB6, 0xBF)
# 3/4 视角：先俯 35°，再绕竖轴转 25°
TILT_DEG, TURN_DEG = 35.0, 25.0
# 相机空间光向（右上前）
LIGHT_DIR = (-0.35, 0.65, 0.9)
# 环境光底噪，避免背光面死黑
AMBIENT = 0.28


# ── STL 解析 ────────────────────────────────────────────────────────────────

def _parse_binary(buf: bytes, n_tri: int) -> np.ndarray:
    """(n,3,3) float32 顶点。50 字节/面：法线 3f + 顶点 9f + 属性 u2（法线不信，自己叉积）"""
    rec = np.dtype([("n", "<3f4"), ("v", "<9f4"), ("attr", "<u2")])
    arr = np.frombuffer(buf, dtype=rec, count=n_tri, offset=84)
    return arr["v"].reshape(-1, 3, 3).astype(np.float32)


def _parse_ascii(buf: bytes) -> np.ndarray:
    txt = buf.decode("ascii", errors="ignore")
    nums = re.findall(r"vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)", txt)
    if len(nums) < 3:
        raise ValueError("ASCII STL 里没解析出顶点")
    v = np.asarray(nums, dtype=np.float32)
    n = (len(v) // 3) * 3
    return v[:n].reshape(-1, 3, 3)


def load_triangles(path: str) -> np.ndarray:
    """读 STL → (n,3,3) 顶点，超过 MAX_TRI 按 stride 抽样"""
    with open(path, "rb") as f:
        buf = f.read()
    size = len(buf)
    tris = None
    if size >= 84:
        n_tri = struct.unpack("<I", buf[80:84])[0]
        if n_tri > 0 and 84 + 50 * n_tri == size:
            tris = _parse_binary(buf, n_tri)
    if tris is None:
        tris = _parse_ascii(buf)
    if len(tris) > MAX_TRI:
        tris = tris[:: max(1, len(tris) // MAX_TRI)]
    return tris


# ── 视角 ────────────────────────────────────────────────────────────────────

def camera_basis(tris: np.ndarray) -> np.ndarray:
    """
    返回 3×3 行向量基 [right, up, forward]（世界 → 相机）。
    最长轴当屏幕横向、最短轴当屏幕竖向 —— 鞋壳（双脚合体 300×288×122 / 单只 288×130×122）
    这样都能把最能认形状的那一面摊向镜头，且与 STL 原始摆位无关。
    """
    flat = tris.reshape(-1, 3)
    ext = flat.max(axis=0) - flat.min(axis=0)
    order = np.argsort(-ext)  # 跨度降序
    a_long, a_mid, a_short = int(order[0]), int(order[1]), int(order[2])

    right = np.zeros(3, np.float32); right[a_long] = 1.0
    up = np.zeros(3, np.float32); up[a_short] = 1.0
    fwd = np.cross(right, up)  # 右手系，指向 a_mid（正负无所谓，转角会带上）
    assert abs(fwd[a_mid]) > 0.5

    m = np.stack([right, up, fwd])  # 行 = 相机轴

    t, u = math.radians(TILT_DEG), math.radians(TURN_DEG)
    # 绕相机横轴俯仰
    rx = np.array([[1, 0, 0],
                   [0, math.cos(t), -math.sin(t)],
                   [0, math.sin(t), math.cos(t)]], np.float32)
    # 绕相机竖轴偏转
    ry = np.array([[math.cos(u), 0, math.sin(u)],
                   [0, 1, 0],
                   [-math.sin(u), 0, math.cos(u)]], np.float32)
    return (rx @ ry @ m).astype(np.float32)


# ── PNG 输出（zlib + struct 手写，不引 PIL）────────────────────────────────

def write_png_rgba(path: str, rgba: np.ndarray) -> None:
    h, w = rgba.shape[:2]
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += rgba[y].tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))  # 8bit RGBA
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(png)
    os.replace(tmp, path)  # 原子替换：并发读到的永远是完整文件


# ── 渲染 ────────────────────────────────────────────────────────────────────

def render_thumb(stl_path: str, out_png: str, size: tuple[int, int] = (OUT_W, OUT_H)) -> bool:
    tris = load_triangles(stl_path)
    if len(tris) == 0:
        return False

    basis = camera_basis(tris)
    # 顶点 → 相机空间；(n,3,3) @ (3,3)^T 一把转完
    cam = tris @ basis.T

    # 面法线（右手叉积；朝向不保证一致，取 |dot| 让两面都受光，与主视图 DoubleSide 同一取舍）
    e1 = cam[:, 1] - cam[:, 0]
    e2 = cam[:, 2] - cam[:, 0]
    nrm = np.cross(e1, e2)
    ln = np.linalg.norm(nrm, axis=1, keepdims=True)
    nrm = nrm / np.maximum(ln, 1e-9)
    ld = np.asarray(LIGHT_DIR, np.float32)
    ld = ld / np.linalg.norm(ld)
    lam = np.abs(nrm @ ld)
    shade = (AMBIENT + (1.0 - AMBIENT) * lam).astype(np.float32)  # (n,)

    # 每三角 7 个采样点：3 顶点 + 3 边中点 + 重心
    v0, v1, v2 = cam[:, 0], cam[:, 1], cam[:, 2]
    pts = np.concatenate([
        v0, v1, v2,
        (v0 + v1) * 0.5, (v1 + v2) * 0.5, (v2 + v0) * 0.5,
        (v0 + v1 + v2) / 3.0,
    ], axis=0).astype(np.float32)
    sh = np.tile(shade, 7)

    W, H = size[0] * SS, size[1] * SS
    x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
    # 正交投影：等比铺满，留 MARGIN 边距
    x0, x1 = float(x.min()), float(x.max())
    y0, y1 = float(y.min()), float(y.max())
    span = max(x1 - x0, (y1 - y0) * W / H, 1e-6)
    k = (W * (1 - 2 * MARGIN)) / span
    px = ((x - (x0 + x1) / 2) * k + W / 2).astype(np.int32)
    # 图像 y 向下，相机 y 向上 → 取反
    py = (-(y - (y0 + y1) / 2) * k + H / 2).astype(np.int32)
    np.clip(px, 0, W - 1, out=px)
    np.clip(py, 0, H - 1, out=py)

    # 深度从远到近排序后散射赋值：后写覆盖先写 ⇒ 近的赢（省一个 z-buffer 比较）
    order = np.argsort(-z, kind="stable")
    idx = (py[order] * W + px[order]).astype(np.int64)
    buf = np.zeros(W * H, np.float32)
    buf[idx] = sh[order]

    # 填洞：空像素取 4 邻域最亮值。只填「被实心区域包住」的麻点，
    # 靠 MAX_FILL 轮上限约束轮廓外扩（每轮 1 个超采样像素 = 1/3 输出像素）。
    img = buf.reshape(H, W)
    for _ in range(MAX_FILL):
        empty = img == 0
        if not empty.any():
            break
        neigh = np.zeros_like(img)
        np.maximum(neigh[1:, :], img[:-1, :], out=neigh[1:, :])
        np.maximum(neigh[:-1, :], img[1:, :], out=neigh[:-1, :])
        np.maximum(neigh[:, 1:], img[:, :-1], out=neigh[:, 1:])
        np.maximum(neigh[:, :-1], img[:, 1:], out=neigh[:, :-1])
        filled = empty & (neigh > 0)
        if not filled.any():
            break
        img[filled] = neigh[filled]

    # 3×3 盒式降采样：抗锯齿；覆盖率当 alpha
    grid = img.reshape(size[1], SS, size[0], SS)
    gray = grid.mean(axis=(1, 3))
    cover = (grid > 0).mean(axis=(1, 3))

    rgba = np.zeros((size[1], size[0], 4), np.uint8)
    with np.errstate(invalid="ignore", divide="ignore"):
        lit = np.where(cover > 0, gray / np.maximum(cover, 1e-6), 0.0)
    for c in range(3):
        rgba[..., c] = np.clip(lit * BASE_RGB[c], 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(cover * 255.0, 0, 255).astype(np.uint8)  # 背景全透明

    write_png_rgba(out_png, rgba)
    return True


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("用法: python stl_thumb.py <in.stl> <out.png>")
        raise SystemExit(2)
    import time
    t0 = time.time()
    ok = render_thumb(sys.argv[1], sys.argv[2])
    print(f"{'ok' if ok else 'FAILED'}  {sys.argv[2]}  {time.time() - t0:.2f}s")
