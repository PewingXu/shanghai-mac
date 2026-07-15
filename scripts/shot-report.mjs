// 开发自验脚本：截取报告页指定视图（等待 3D 姿态动画完成后截图）
// 用法: node scripts/shot-report.mjs [panel] [输出路径]
import puppeteer from "puppeteer-core";

const panel = process.argv[2] || "pressure";
const out = process.argv[3] || `C:/tmp/report-${panel}.png`;

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1600,900", "--use-angle=swiftshader"],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`http://127.0.0.1:3000/?view=report&panel=${panel}`, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000)); // 等 GLTF 加载 + 姿态动画收敛
await page.screenshot({ path: out });
await browser.close();
console.log("saved:", out);
