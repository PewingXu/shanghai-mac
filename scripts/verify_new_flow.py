# 验证新入口流程：landing 新设计 → 开始体验（无设备时错误提示）→ 采集页体验模式
# → 点开始测量弹登记 → 登记后自动开始采集。
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(r"C:\tmp\new-flow")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge")  # 系统 Edge，免下载浏览器
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    # 1) landing 新设计
    page.goto(BASE)
    page.wait_for_timeout(1800)
    page.screenshot(path=str(OUT / "01-landing.png"))

    # 2) 点开始体验（headless 无真实串口：期望出现连接失败提示，不跳页）
    page.get_by_role("button", name="开始体验").click()
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / "02-landing-after-start.png"))

    # 3) 直达采集页（体验模式，无用户）
    page.goto(f"{BASE}/?view=measure")
    page.wait_for_timeout(2500)
    page.screenshot(path=str(OUT / "03-measure-trial.png"))

    # 4) 点“开始测量” → 应弹出登记信息表单
    page.get_by_text("开始测量").first.click()
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / "04-register-modal.png"))

    # 5) 填姓名提交 → 弹窗关闭、倒计时开始
    page.get_by_placeholder("请输入姓名").fill("测试用户")
    page.get_by_role("button", name="登记并开始采集").click()
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / "05-collecting.png"))

    browser.close()
print("done ->", OUT)
