# 验证报告页 COP 视图切换动画：走 历史用户 → 采集记录 → 报告页 → 点 COP 卡片，
# 连拍多帧截图观察热力图/轨迹的缩放展开效果。
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(r"C:\tmp\cop-frames")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.goto(f"{BASE}/?view=history")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / "01-history.png"))

    # 点第一个历史用户卡片（历史页任何含用户名的可点元素）
    # 先尝试常见结构：列表项点击
    clicked = False
    for sel in ["text=查看", "text=详情"]:
        loc = page.locator(sel)
        if loc.count():
            loc.first.click()
            clicked = True
            break
    if not clicked:
        # 兜底：点页面中部第一个卡片状元素
        page.mouse.click(400, 400)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(OUT / "02-userRecords.png"))

    # 点第一条采集记录
    rec = page.locator("text=/\\d{4}[-.年]/").first
    try:
        rec.click(timeout=3000)
    except Exception:
        page.mouse.click(800, 400)
    page.wait_for_timeout(4000)  # 等报告页 + 3D 模型加载
    page.screenshot(path=str(OUT / "03-report-dims.png"))

    # 点 COP 卡片并连拍动画帧
    cop_card = page.get_by_text("cop平衡指标", exact=False).first
    cop_card.click()
    t0 = time.time()
    for i in range(10):
        page.screenshot(path=str(OUT / f"04-cop-{i:02d}-{int((time.time()-t0)*1000):04d}ms.png"))
        page.wait_for_timeout(90)
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / "05-cop-settled.png"))

    # 切回 dims 再切回 COP，验证重复切换也有动画
    page.get_by_text("足底尺寸", exact=False).first.click()
    page.wait_for_timeout(1200)
    cop_card.click()
    t0 = time.time()
    for i in range(8):
        page.screenshot(path=str(OUT / f"06-cop2-{i:02d}-{int((time.time()-t0)*1000):04d}ms.png"))
        page.wait_for_timeout(90)

    browser.close()
print("done ->", OUT)
