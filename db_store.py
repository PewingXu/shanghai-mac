"""
ACIKI 持久化层（SQLite，标准库 sqlite3，零额外依赖）。

设计参考 laonianren-express（serialServer.js + util/db.js）的"结构化进 SQLite、
大 blob 落磁盘文件、DB 只存路径"策略，并做简化：
  - users   : 用户（id 唯一 5 位，name 可重复）
  - records : 每用户每次采集记录；测量大数据（analysis JSON，含热力图/COP/base64 图）
              落盘为 data/records/<id>.json，DB 只存 data_path

连接策略：每次操作开一个短连接（sqlite3.connect 很轻），避免 FastAPI 线程池下的
跨线程复用问题；开启 WAL 提升写并发（同 laonianren util/db.js 的 PRAGMA）。
数据目录：环境变量 ACIKI_DATA_DIR 覆盖，否则 <本文件目录>/data。
"""
import os
import json
import sqlite3
import random
from typing import Any, Optional

_DATA_DIR = os.environ.get("ACIKI_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DB_PATH = os.path.join(_DATA_DIR, "aciki.db")
_RECORDS_DIR = os.path.join(_DATA_DIR, "records")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """建库建表（幂等）。首次调用时创建目录与表。"""
    os.makedirs(_DATA_DIR, exist_ok=True)
    os.makedirs(_RECORDS_DIR, exist_ok=True)
    conn = _connect()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY,   -- 唯一标识（5 位）；名字可重复
                name       TEXT NOT NULL,
                gender     TEXT,
                birth_date TEXT,
                height     REAL,
                weight     REAL,
                shoe_size  TEXT,                  -- 鞋码（预留，暂占位）
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                date       TEXT,
                time       TEXT,
                data_path  TEXT,                  -- 分析结果 JSON 文件路径（相对 data 目录）
                raw_path   TEXT,                  -- 原始帧 CSV 文件路径（相对 data 目录，界面不暴露）
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        # 自愈补列（老库升级）：参考 laonianren ensureHistoryColumns 的做法
        cols = {r[1] for r in conn.execute("PRAGMA table_info(records)").fetchall()}
        if "raw_path" not in cols:
            conn.execute("ALTER TABLE records ADD COLUMN raw_path TEXT")
        # 按用户查历史记录的索引（一人多次采集，WHERE user_id=? 走索引）
        conn.execute("CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id)")
        conn.commit()
    finally:
        conn.close()


def _user_to_dict(row: sqlite3.Row) -> dict:
    """DB 行 → 前端 User 形状（camelCase birthDate）。"""
    return {
        "id": row["id"],
        "name": row["name"],
        "gender": row["gender"],
        "birthDate": row["birth_date"],
        "height": row["height"],
        "weight": row["weight"],
        "shoeSize": row["shoe_size"],
    }


def list_users() -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC, id DESC").fetchall()
        return [_user_to_dict(r) for r in rows]
    finally:
        conn.close()


def _gen_unique_id(conn: sqlite3.Connection) -> int:
    """生成不与现有 id 撞号的 5 位 id。"""
    existing = {r[0] for r in conn.execute("SELECT id FROM users").fetchall()}
    for _ in range(10000):
        cand = random.randint(10000, 99999)
        if cand not in existing:
            return cand
    # 极端兜底：用 max+1
    row = conn.execute("SELECT COALESCE(MAX(id), 9999) + 1 AS nid FROM users").fetchone()
    return int(row["nid"])


def create_user(data: dict) -> dict:
    """新建用户。若 data.id 提供且未占用则沿用，否则服务端生成唯一 id。返回完整用户。"""
    conn = _connect()
    try:
        want = data.get("id")
        if want is not None:
            taken = conn.execute("SELECT 1 FROM users WHERE id=?", (int(want),)).fetchone()
            uid = int(want) if not taken else _gen_unique_id(conn)
        else:
            uid = _gen_unique_id(conn)
        conn.execute(
            "INSERT INTO users (id, name, gender, birth_date, height, weight, shoe_size) VALUES (?,?,?,?,?,?,?)",
            (
                uid,
                (data.get("name") or "").strip() or "未命名",
                data.get("gender"),
                data.get("birthDate"),
                data.get("height"),
                data.get("weight"),
                data.get("shoeSize"),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return _user_to_dict(row)
    finally:
        conn.close()


def delete_users(ids: list[int]) -> int:
    """按 id 批量删除用户（级联删除其 records 及全部落盘文件）。返回删除条数。"""
    if not ids:
        return 0
    conn = _connect()
    try:
        # 先删各用户落盘的 record 文件（分析 JSON + 原始 CSV）
        qmarks = ",".join("?" for _ in ids)
        rows = conn.execute(f"SELECT data_path, raw_path FROM records WHERE user_id IN ({qmarks})", ids).fetchall()
        for r in rows:
            _remove_record_file(r["data_path"])
            _remove_record_file(r["raw_path"])
        cur = conn.execute(f"DELETE FROM users WHERE id IN ({qmarks})", ids)
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


# ─── records（二期用；先备好，一期前端可暂不调用） ──────────────────────────────
def _record_rel_path(rid: int) -> str:
    return os.path.join("records", f"{rid}.json")


def _remove_record_file(rel_path: Optional[str]) -> None:
    if not rel_path:
        return
    try:
        os.remove(os.path.join(_DATA_DIR, rel_path))
    except OSError:
        pass


def list_records(user_id: int) -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, user_id, date, time, created_at FROM records WHERE user_id=? ORDER BY created_at DESC, id DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _write_raw_csv(path: str, frames: list, fps: float) -> None:
    """把原始帧写成与 sit2026-*.csv 同构的 CSV：
    列 = (秒偏移),max,time,area,press,data；data 为引号包裹的 4096 长度数组字面量。
    该格式与 OneStep_report.load_csv_data / 前端导入完全兼容，可直接重新分析。"""
    from datetime import datetime, timedelta

    base = datetime.now()
    step = 1.0 / (fps if fps > 0 else 42)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(",max,time,area,press,data\n")
        for i, frame in enumerate(frames):
            vals = [int(v) if float(v).is_integer() else float(v) for v in frame]
            mx = max(vals) if vals else 0
            area = sum(1 for v in vals if v > 0)
            press = sum(vals)
            t = base + timedelta(seconds=i * step)
            tstr = f"{t.year}/{t.month}/{t.day} {t.hour:02d}:{t.minute:02d}:{t.second:02d}:{t.microsecond // 1000:03d}"
            data_str = "[" + ",".join(str(v) for v in vals) + "]"
            f.write(f"{i * step:.2f},{mx},{tstr},{area},{press},\"{data_str}\"\n")


def create_record(
    user_id: int,
    date: str,
    time: str,
    data: Any,
    raw_frames: Optional[list] = None,
    fps: float = 42,
) -> dict:
    """新建一条采集记录：插行拿 id → 分析结果落盘 records/<id>.json；
    原始帧（可选）落盘 records/<id>.csv（仿 sit CSV 格式，界面不暴露，仅存档/重分析用）。"""
    conn = _connect()
    try:
        cur = conn.execute(
            "INSERT INTO records (user_id, date, time, data_path, raw_path) VALUES (?,?,?,?,?)",
            (user_id, date, time, None, None),
        )
        rid = cur.lastrowid
        rel = _record_rel_path(rid)
        with open(os.path.join(_DATA_DIR, rel), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        raw_rel = None
        if raw_frames:
            raw_rel = os.path.join("records", f"{rid}.csv")
            _write_raw_csv(os.path.join(_DATA_DIR, raw_rel), raw_frames, fps)
        conn.execute("UPDATE records SET data_path=?, raw_path=? WHERE id=?", (rel, raw_rel, rid))
        conn.commit()
        return {"id": rid, "user_id": user_id, "date": date, "time": time}
    finally:
        conn.close()


def get_record_data(rid: int) -> Optional[Any]:
    conn = _connect()
    try:
        row = conn.execute("SELECT data_path FROM records WHERE id=?", (rid,)).fetchone()
        if not row or not row["data_path"]:
            return None
        path = os.path.join(_DATA_DIR, row["data_path"])
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    finally:
        conn.close()


def delete_record(rid: int) -> int:
    conn = _connect()
    try:
        row = conn.execute("SELECT data_path, raw_path FROM records WHERE id=?", (rid,)).fetchone()
        if row:
            _remove_record_file(row["data_path"])
            _remove_record_file(row["raw_path"])
        cur = conn.execute("DELETE FROM records WHERE id=?", (rid,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()
