# -*- coding: utf-8 -*-
"""
演示数据生成器：向 SQLite 灌一批虚构用户 + 每人多条可打开的测量记录。

用法（在项目根目录）：
    C:/Users/xpr12/anaconda3/python.exe scripts/seed_demo_data.py [数量]
    数量缺省 235（配合已有用户凑满 20+ 页，每页 12 人）

原理：用仓库内真实测量 CSV 跑一次完整分析得到"模板报告"，每条假记录在
模板上做数值扰动（足弓指数/尺寸/COP 指标/压力等），保证报告页点开就能
渲染且各条数据互不相同。分区坐标与热力帧沿用模板（视觉一致、指标不同）。

体积控制：删除前端不用的 cop_time_series 大数组、COP 轨迹下采样到 ~300 点，
单条记录约 60KB（原始 228KB）。

注意：仅供演示/测试；重复运行会追加新用户（自增 ID 顺延）。
"""

import copy
import os
import random
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import matplotlib

matplotlib.use("Agg")

import db_store
from OneStep_report import load_csv_data
from api_server import run_analysis

CSV_SAMPLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sit2026-2-28 13-18-29.csv")

random.seed(20260819)  # 可复现

# ── 随机中文姓名池（组合生成大批量虚构用户） ─────────────────────────────────
SURNAMES = "李王张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕"
MALE_NAMES = ["志强", "建国", "浩然", "子轩", "光明", "德华", "俊杰", "文博", "国栋", "永强",
              "海涛", "鹏飞", "立军", "世杰", "宇航", "泽宇", "锦程", "嘉懿", "明辉", "劲松"]
FEMALE_NAMES = ["欣怡", "淑兰", "雨桐", "美玲", "桂芳", "雪梅", "静怡", "丽华", "秀英", "婉婷",
                "梦琪", "紫涵", "诗涵", "玉兰", "凤英", "海燕", "彩霞", "书瑶", "晓彤", "语嫣"]

EMAIL_DOMAINS = ["qq.com", "163.com", "126.com", "gmail.com", "outlook.com"]


def make_fake_user() -> dict:
    gender = random.choice(["男", "女"])
    name = random.choice(SURNAMES) + random.choice(MALE_NAMES if gender == "男" else FEMALE_NAMES)
    age = random.randint(18, 78)
    if gender == "男":
        height, weight, shoe = random.randint(162, 186), random.randint(55, 88), random.choice(["40", "41", "42", "43", "44"])
    else:
        height, weight, shoe = random.randint(150, 172), random.randint(42, 70), random.choice(["35", "36", "37", "38", "39"])
    phone = "1" + random.choice("3456789") + "".join(random.choice("0123456789") for _ in range(9))
    return {"name": name, "gender": gender, "age": age, "height": height, "weight": weight, "shoe": shoe, "phone": phone}


def birth_from_age(age: int) -> str:
    today = date.today()
    d = today.replace(year=today.year - age) - timedelta(days=random.randint(0, 330))
    return d.strftime("%Y-%m-%d")


def jitter(value, pct):
    """数值 ±pct 相对扰动（保留原类型的合理精度）"""
    if not isinstance(value, (int, float)):
        return value
    scaled = value * random.uniform(1 - pct, 1 + pct)
    return round(scaled, 4) if isinstance(value, float) else int(round(scaled))


ARCH_TYPES = [(0.21, "高足弓(high arch)"), (0.26, "正常足弓(normal arch)"), (9.9, "扁平足(flat foot)")]


def classify_arch(index: float) -> str:
    for th, name in ARCH_TYPES:
        if index < th:
            return name
    return ARCH_TYPES[-1][1]


def slim_template(template: dict) -> dict:
    """瘦身：删前端不用的大数组、COP 轨迹下采样到 ~300 点（228KB → ~60KB/条）"""
    m = copy.deepcopy(template)
    cop = m.get("cop_time_series")
    if isinstance(cop, dict):
        for k in ("time_series", "time_points", "velocity_series"):
            cop.pop(k, None)
    for k in ("left_cop_trajectory", "right_cop_trajectory"):
        traj = m.get(k)
        if isinstance(traj, list) and len(traj) > 320:
            step = max(1, len(traj) // 300)
            m[k] = traj[::step]
    return m


def perturb_metrics(template: dict) -> dict:
    """在（已瘦身的）模板报告上做随机扰动，产出一条"看起来独立"的分析结果"""
    m = copy.deepcopy(template)

    for side in ("left_foot", "right_foot"):
        foot = m.get("arch_features", {}).get(side)
        if foot:
            idx = max(0.12, min(0.38, jitter(float(foot.get("area_index", 0.25)), 0.25)))
            foot["area_index"] = round(idx, 4)
            foot["area_type"] = classify_arch(idx)

    ad = m.get("additional_data")
    if ad:
        for k in ("left_length", "right_length", "left_width", "right_width"):
            if k in ad:
                ad[k] = round(jitter(float(ad[k]), 0.06), 2)
        for k in ("left_area", "right_area"):
            blk = ad.get(k)
            if isinstance(blk, dict) and "total_area_cm2" in blk:
                blk["total_area_cm2"] = round(jitter(float(blk["total_area_cm2"]), 0.1), 2)

    cop = m.get("cop_time_series")
    if isinstance(cop, dict):
        for k, v in cop.items():
            if isinstance(v, (int, float)):
                cop[k] = round(jitter(float(v), 0.2), 3)

    return m


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 235
    db_store.init_db()
    print(f"[seed] 目标 {count} 个用户；以真实 CSV 生成模板报告（约 1 分钟）…")
    raw = load_csv_data(CSV_SAMPLE)
    template = slim_template(run_analysis(raw, fps=42, threshold_ratio=0.8)["metrics"])
    print("[seed] 模板就绪，开始灌入演示数据")

    now = datetime.now()
    total_records = 0
    for i in range(count):
        spec = make_fake_user()
        user = db_store.create_user(
            {
                "name": spec["name"],
                "gender": spec["gender"],
                "birthDate": birth_from_age(spec["age"]),
                "height": spec["height"],
                "weight": spec["weight"],
                "shoeSize": spec["shoe"],
                "phone": spec["phone"],
                "email": f"{spec['phone']}@{random.choice(EMAIL_DOMAINS)}",
            }
        )
        for _ in range(random.randint(1, 3)):
            metrics = perturb_metrics(template)
            analysis = {
                "python": {"success": True, "data": metrics},
                "mli": {"left": round(random.uniform(0.85, 1.25), 2), "right": round(random.uniform(0.85, 1.25), 2)},
                "frontend": {
                    "leftPressure": int(jitter(15000, 0.25)),
                    "rightPressure": int(jitter(15000, 0.25)),
                    "leftArea": int(jitter(110, 0.15)),
                    "rightArea": int(jitter(110, 0.15)),
                },
            }
            ts = now - timedelta(days=random.randint(1, 90), hours=random.randint(0, 12), minutes=random.randint(0, 59))
            db_store.create_record(
                user_id=user["id"],
                date=ts.strftime("%Y-%m-%d"),
                time=ts.strftime("%H:%M:%S"),
                data=analysis,
            )
            total_records += 1
        if (i + 1) % 25 == 0:
            print(f"  已生成 {i + 1}/{count} 用户，{total_records} 条记录")

    print(f"[seed] 完成 ✅ 共 {count} 用户 / {total_records} 条记录")


if __name__ == "__main__":
    main()
