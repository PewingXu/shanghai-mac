# -*- coding: utf-8 -*-
"""
体验记录演示数据：向 SQLite 灌 N 条可打开的测量记录（默认 100 条）。

用法（项目根目录）：
    C:/Users/xpr12/anaconda3/python.exe scripts/seed_demo_records.py [数量]

体验模式不登记人名，全部记录挂在同一个匿名「体验」用户名下（与前端
AppContext.ANON_USER_NAME 同名；没有就创建）。时间随机落在最近 60 天，
约 45% 的记录附带一份解决方案快照（列表里显示「已定制」+ 方案更新时间）。

模板报告：用 samples/sample-standing.csv 前 30s（1260 帧）跑一次真实分析，
每条记录在模板上做数值扰动（同 seed_demo_data.perturb_metrics）。

注意：仅供演示；重复运行会继续追加。
"""

import os
import random
import sys
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import matplotlib

matplotlib.use("Agg")

import db_store
from OneStep_report import load_csv_data
from api_server import run_analysis
from seed_demo_data import jitter, perturb_metrics, slim_template

ANON_USER_NAME = "体验"
CSV_SAMPLE = os.path.join(ROOT, "samples", "sample-standing.csv")
TEMPLATE_FRAMES = 1260  # 42fps × 30s
EDITED_RATIO = 0.45

random.seed(20260910)

INSOLE_STYLES = ["comfort", "sport", "standard"]
INSOLE_COLORS = ["#ECECEC", "#ECECEC", "#FF8C42", "#6AA6F0", "#5FD0B0", "#3D3D3D"]
ARCH_LEVELS = {
    2: ("中度高弓足", 8.0),
    3: ("轻度高弓足", 6.0),
    4: ("正常足弓", 2.0),
    5: ("轻度扁平足", 4.0),
    6: ("中度扁平足", 6.0),
}


def make_foot(shoe_size: int) -> dict:
    level = random.choice(list(ARCH_LEVELS))
    arch_type, correction = ARCH_LEVELS[level]
    return {
        "params": {
            "footLength": round(random.uniform(22.5, 28.0), 1),
            "footWidth": round(random.uniform(8.4, 10.6), 1),
            "archCorrection": correction,
            "archLevel": level,
            "archType": arch_type,
            "baseThickness": 0.6,
            "pressureRatio": round(random.uniform(0.44, 0.56), 3),
            "heelThickness": random.choice([10, 12, 15, 18, 20]),
            "latticeDensity": random.randint(2, 4),
        },
        "hardness": random.choice([40, 45, 50, 55, 60]),
        "shoeSize": shoe_size,
        "baseDeltaMm": random.choice([-2, -1, 0, 0, 1, 2, 3]),
    }


def make_snapshot() -> dict:
    """与前端 solutionSnapshot.SolutionSnapshot 同构（v=1）"""
    shoe = random.randint(36, 44)
    return {
        "v": 1,
        "insoleStyle": random.choice(INSOLE_STYLES),
        "insoleColor": random.choice(INSOLE_COLORS),
        "insoleSize": {"left": {"length": "", "width": ""}, "right": {"length": "", "width": ""}},
        "shellView": "off",
        "feet": {"left": make_foot(shoe), "right": make_foot(shoe)},
    }


def get_or_create_anon_user() -> dict:
    for u in db_store.list_users():
        if u.get("name") == ANON_USER_NAME:
            return u
    return db_store.create_user({"name": ANON_USER_NAME})


def main():
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    db_store.init_db()
    if not os.path.exists(CSV_SAMPLE):
        print(f"[seed] 找不到样本 CSV：{CSV_SAMPLE}")
        sys.exit(1)

    print(f"[seed] 目标 {count} 条记录；以样本 CSV 前 {TEMPLATE_FRAMES} 帧生成模板报告（约 1 分钟）…")
    raw = load_csv_data(CSV_SAMPLE)
    raw = raw[:TEMPLATE_FRAMES]
    template = slim_template(run_analysis(raw, fps=42, threshold_ratio=0.8)["metrics"])
    print("[seed] 模板就绪，开始灌入")

    user = get_or_create_anon_user()
    now = datetime.now()
    # 时间：最近 60 天内随机，按时间升序插入（自增 id 与时间顺序一致）
    stamps = sorted(
        now - timedelta(days=random.uniform(0.2, 60), seconds=random.randint(0, 3600 * 10))
        for _ in range(count)
    )
    edited = 0
    for i, ts in enumerate(stamps):
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
        rec = db_store.create_record(
            user_id=user["id"],
            date=ts.strftime("%Y-%m-%d"),
            time=ts.strftime("%H:%M:%S"),
            data=analysis,
        )
        if random.random() < EDITED_RATIO:
            upd = ts + timedelta(minutes=random.randint(2, 40))
            db_store.save_record_solution(rec["id"], make_snapshot(), upd.strftime("%Y-%m-%d %H:%M"))
            edited += 1
        if (i + 1) % 25 == 0:
            print(f"  已生成 {i + 1}/{count}")

    print(f"[seed] 完成 ✅ 共 {count} 条记录（{edited} 条已定制方案），挂在用户「{ANON_USER_NAME}」(id={user['id']})")


if __name__ == "__main__":
    main()
