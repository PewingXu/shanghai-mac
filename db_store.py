"""
ACIKI 持久化层（SQLite，标准库 sqlite3，零额外依赖）。

设计参考 laonianren-express（serialServer.js + util/db.js）的"结构化进 SQLite、
大 blob 落磁盘文件、DB 只存路径"策略，并做简化：
  - users   : 用户（id 唯一 5 位，name 可重复）
  - records : 每用户每次采集记录；测量大数据（analysis JSON，含热力图/COP/base64 图）
              落盘为 data/records/<id>.json，DB 只存 data_path。
              解决方案页改过的参数（约 1KB 结构化数据）直接存 solution_json 列，不落盘。
  - shells  : 上传的鞋壳（几十上百 MB 的 STL），文件落盘 data/shells/<id>.stl，DB 只存 path。
              形态缩略图 data/shells/<id>.png（stl_thumb.py 渲的灰模，供选择抽屉的卡片），
              路径由 id 直接推出，DB 不为它加列（见 shell_thumb_path）。

连接策略：每次操作开一个短连接（sqlite3.connect 很轻），避免 FastAPI 线程池下的
跨线程复用问题；开启 WAL 提升写并发（同 laonianren util/db.js 的 PRAGMA）。
数据目录：环境变量 ACIKI_DATA_DIR 覆盖，否则 <本文件目录>/data。
"""
import os
import json
import sqlite3
from typing import Any, Iterable, Optional

_DATA_DIR = os.environ.get("ACIKI_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_DB_PATH = os.path.join(_DATA_DIR, "aciki.db")
_RECORDS_DIR = os.path.join(_DATA_DIR, "records")
_SHELLS_DIR = os.path.join(_DATA_DIR, "shells")


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
    os.makedirs(_SHELLS_DIR, exist_ok=True)
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
                phone      TEXT,                  -- 手机号（展示脱敏：前四****尾四；支持尾号搜索）
                email      TEXT,                  -- 联系邮箱
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
                solution_json       TEXT,         -- 解决方案页改过的参数快照（约 1KB，直接内联）
                solution_created_at TEXT,         -- 首次保存方案的时间（留档，界面不展示）
                solution_updated_at TEXT,         -- 最后一次保存方案的时间（记录行「方案更新时间」列）
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        # 自愈补列（老库升级）：参考 laonianren ensureHistoryColumns 的做法
        cols = {r[1] for r in conn.execute("PRAGMA table_info(records)").fetchall()}
        for col in ("raw_path", "solution_json", "solution_created_at", "solution_updated_at"):
            if col not in cols:
                conn.execute(f"ALTER TABLE records ADD COLUMN {col} TEXT")
        ucols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        for col in ("phone", "email"):
            if col not in ucols:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
        # 按用户查历史记录的索引（一人多次采集，WHERE user_id=? 走索引）
        conn.execute("CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shells (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                label      TEXT NOT NULL,         -- 展示名（默认文件名去扩展名，可重名）
                filename   TEXT,
                size       INTEGER,               -- 字节数（选择窗口里展示）
                path       TEXT,                  -- STL 文件路径（相对 data 目录）
                adjust     TEXT,                  -- 手动微调 JSON；null = 默认摆位
                created_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
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
        "phone": row["phone"],
        "email": row["email"],
    }


def list_users() -> list[dict]:
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY created_at DESC, id DESC").fetchall()
        return [_user_to_dict(r) for r in rows]
    finally:
        conn.close()


def _gen_unique_id(conn: sqlite3.Connection) -> int:
    """自增用户 id：从 1 开始连贯递增（展示时补零为 00001 格式），
    99999 之后自然顺延 100000+，无上限。取当前最大 id + 1，天然唯一。"""
    row = conn.execute("SELECT COALESCE(MAX(id), 0) + 1 AS nid FROM users").fetchone()
    return int(row["nid"])


def next_user_id() -> int:
    """预览下一个将分配的用户 id（创建弹窗标题展示用；真正分配以 create_user 为准）。"""
    conn = _connect()
    try:
        return _gen_unique_id(conn)
    finally:
        conn.close()


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
            "INSERT INTO users (id, name, gender, birth_date, height, weight, shoe_size, phone, email) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                uid,
                (data.get("name") or "").strip() or "未命名",
                data.get("gender"),
                data.get("birthDate"),
                data.get("height"),
                data.get("weight"),
                data.get("shoeSize"),
                (data.get("phone") or "").strip() or None,
                (data.get("email") or "").strip() or None,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return _user_to_dict(row)
    finally:
        conn.close()


def update_user(data: dict) -> dict | None:
    """按 id 更新用户基础信息（编辑用户弹窗）。返回更新后的完整用户；id 不存在返回 None。"""
    conn = _connect()
    try:
        uid = int(data["id"])
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            return None
        conn.execute(
            "UPDATE users SET name=?, gender=?, birth_date=?, height=?, weight=?, shoe_size=?, phone=?, email=? WHERE id=?",
            (
                (data.get("name") or "").strip() or "未命名",
                data.get("gender"),
                data.get("birthDate"),
                data.get("height"),
                data.get("weight"),
                data.get("shoeSize"),
                (data.get("phone") or "").strip() or None,
                (data.get("email") or "").strip() or None,
                uid,
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
    """列表只带元数据 + 方案时间戳，不带 solution_json（避免 1KB×N 的无用负载）。"""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, user_id, date, time, created_at, solution_created_at, solution_updated_at "
            "FROM records WHERE user_id=? ORDER BY created_at DESC, id DESC",
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


def save_record_solution(rid: int, solution: Any, updated_at: str) -> bool:
    """保存/覆盖某条记录的解决方案快照。返回 False = 记录不存在。

    时间戳由前端传本地时间字符串（同 create_record 的 date/time），
    不用 datetime('now')——那是 UTC，与界面上其它时间对不上。
    solution_created_at 只在第一次保存时写入，之后每次只刷新 updated_at。
    """
    conn = _connect()
    try:
        row = conn.execute("SELECT solution_created_at FROM records WHERE id=?", (rid,)).fetchone()
        if not row:
            return False
        created = row["solution_created_at"] or updated_at
        conn.execute(
            "UPDATE records SET solution_json=?, solution_created_at=?, solution_updated_at=? WHERE id=?",
            (json.dumps(solution, ensure_ascii=False), created, updated_at, rid),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def get_record_solution(rid: int) -> Optional[dict]:
    """读回方案快照 + 两个时间戳；从未保存过方案返回 None。"""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT solution_json, solution_created_at, solution_updated_at FROM records WHERE id=?",
            (rid,),
        ).fetchone()
        if not row or not row["solution_json"]:
            return None
        return {
            "solution": json.loads(row["solution_json"]),
            "created_at": row["solution_created_at"],
            "updated_at": row["solution_updated_at"],
        }
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


# ─── 鞋壳仓库（元数据进 SQLite，STL 落盘 data/shells/<id>.stl） ─────────────────
def _shell_rel_path(sid: int) -> str:
    return os.path.join("shells", f"{sid}.stl")


def _shell_thumb_rel_path(sid: int) -> str:
    return os.path.join("shells", f"{sid}.png")


def shell_thumb_path(sid: int) -> str:
    """
    鞋壳形态缩略图的绝对路径（可能还不存在 —— 由 api_server 按需渲染，见 stl_thumb.py）。
    路径可由 id 直接推出，所以 DB 里不为它加列。
    """
    return os.path.join(_DATA_DIR, _shell_thumb_rel_path(sid))


def _shell_to_dict(row: sqlite3.Row) -> dict:
    """adjust 列在 DB 里是 JSON 字符串，出库即解成对象（前端直接当 ShellAdjust 用）。"""
    d = dict(row)
    raw = d.get("adjust")
    try:
        d["adjust"] = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        d["adjust"] = None
    # 缩略图是否已就绪：前端据此决定卡片先显示骨架还是直接上图
    d["hasThumb"] = os.path.exists(shell_thumb_path(d["id"])) if d.get("id") else False
    return d


def list_shells() -> list[dict]:
    """按上传时间倒序列出全部鞋壳（选择窗口用；不含文件内容）。"""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, label, filename, size, adjust, created_at FROM shells ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return [_shell_to_dict(r) for r in rows]
    finally:
        conn.close()


def create_shell(label: str, filename: str, chunks: Iterable[bytes]) -> dict:
    """新增一个鞋壳：先插行拿 id → 边收边写盘（几十上百 MB，不整体驻留内存）→ 回写 path/size。

    写盘失败会把刚插的行删掉，不留孤儿记录。
    """
    conn = _connect()
    try:
        cur = conn.execute(
            "INSERT INTO shells (label, filename, size, path) VALUES (?,?,?,?)",
            ((label or "").strip() or "未命名鞋壳", filename, 0, None),
        )
        sid = cur.lastrowid
        conn.commit()
        rel = _shell_rel_path(sid)
        abs_path = os.path.join(_DATA_DIR, rel)
        size = 0
        try:
            with open(abs_path, "wb") as f:
                for chunk in chunks:
                    if chunk:
                        f.write(chunk)
                        size += len(chunk)
        except Exception:
            conn.execute("DELETE FROM shells WHERE id=?", (sid,))
            conn.commit()
            _remove_record_file(rel)
            raise
        conn.execute("UPDATE shells SET path=?, size=? WHERE id=?", (rel, size, sid))
        conn.commit()
        row = conn.execute(
            "SELECT id, label, filename, size, adjust, created_at FROM shells WHERE id=?", (sid,)
        ).fetchone()
        return _shell_to_dict(row)
    finally:
        conn.close()


def shell_path(sid: int) -> Optional[str]:
    """鞋壳 STL 的绝对路径；记录或文件不存在返回 None。"""
    conn = _connect()
    try:
        row = conn.execute("SELECT path FROM shells WHERE id=?", (sid,)).fetchone()
        if not row or not row["path"]:
            return None
        path = os.path.join(_DATA_DIR, row["path"])
        return path if os.path.exists(path) else None
    finally:
        conn.close()


def save_shell_adjust(sid: int, adjust: Any) -> bool:
    """记住某个鞋壳的手动微调摆位（校正过一次就不用每次重来）。"""
    conn = _connect()
    try:
        cur = conn.execute(
            "UPDATE shells SET adjust=? WHERE id=?",
            (json.dumps(adjust, ensure_ascii=False) if adjust is not None else None, sid),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def delete_shell(sid: int) -> int:
    conn = _connect()
    try:
        row = conn.execute("SELECT path FROM shells WHERE id=?", (sid,)).fetchone()
        if row:
            _remove_record_file(row["path"])  # 同一套「相对 data 目录 → 静默删」逻辑
            _remove_record_file(_shell_thumb_rel_path(sid))  # 连带删缩略图，别留孤儿 PNG
        cur = conn.execute("DELETE FROM shells WHERE id=?", (sid,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()
