# -*- coding: utf-8 -*-
"""
串口桥 —— 复刻旧交付系统 serialServer.js 的足垫自动连接（后端直连串口版）。

流程（与 laonianren-express 的 serialServer.js 一致）：
  1. serial.tools.list_ports 扫描电脑上全部 COM 口（前端浏览器做不到这一步）；
  2. 逐个以 3M 波特率打开，每 300ms 发 "AT+NAME=ESP32\\r\\n"，在字节流中
     解析设备回复 "Unique ID: <设备码>"；
  3. 设备码与登记的足垫码比对，一致则锁定该口开始持续读帧；
  4. 数据帧协议：4096 字节/帧 + 4 字节分隔符 AA 55 03 99（64×64 行优先）；
  5. 帧经 WebSocket /device/stream 以二进制推给前端；状态变化以 JSON 文本推送；
  6. 断线/拔插自动重扫重连（未连接状态下每 3s 扫一轮）。

前端因此零授权、零弹窗：进系统由后端桥自动完成设备发现与校验。

手动兜底（自动扫描实在匹配不上时）：
  - list_ports()          列出全部 COM 口给前端挑；
  - connect_manual(port)  只开用户指定的口：照常发 AT 读设备码，不管码是否匹配都进入读帧，
                          但必须在 FIRST_FRAME_TIMEOUT_S 内收到带分隔符的完整帧才算连上——
                          选错口（不是足垫）会明确报错而不是界面空转；
  - set_device_code(code) 把手动连上的那块足垫登记为默认设备码（落盘 data/device.json），
                          下次开机自动扫描就能直接命中，手动选口只需做一次；
  - 成功的手动口记为 preferredPort，之后自动扫描优先试它。
"""

import asyncio
import json
import os
import re
import threading
import time

import serial
import serial.tools.list_ports

# 设备登记落盘：与 db_store 同一个数据目录（ACIKI_DATA_DIR 覆盖，否则 <本文件目录>/data）
_DATA_DIR = os.environ.get("ACIKI_DATA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_CONFIG_PATH = os.path.join(_DATA_DIR, "device.json")

# 出厂登记的足垫设备码（旧系统登记格式 "330005000251333232353831:foot1"，":foot1" 槽位已弃用）。
DEFAULT_DEVICE_CODE = "330005000251333232353831"


def _load_config() -> dict:
    try:
        with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_config(cfg: dict) -> None:
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"[bridge] save config failed: {exc}")


def _resolve_device_code(cfg: dict) -> str:
    """设备码优先级：环境变量 ACIKI_DEVICE_CODE > data/device.json 登记 > 出厂默认。"""
    env = os.environ.get("ACIKI_DEVICE_CODE", "").strip()
    if env:
        return env.upper()
    saved = str(cfg.get("deviceCode") or "").strip()
    return saved.upper() if saved else DEFAULT_DEVICE_CODE


# 兼容旧引用：模块加载时解析一次（运行期以 bridge.device_code 为准，登记后会变）
DEVICE_CODE = _resolve_device_code(_load_config())

BAUD_RATE = 3_000_000
AT_QUERY = bytes.fromhex("41542B4E414D453D45535033320d0a")  # "AT+NAME=ESP32\r\n"
FRAME_FOOTER = b"\xaa\x55\x03\x99"
FRAME_SIZE = 4096
IDENTITY_TIMEOUT_S = 4.0     # 单口身份查询超时（同前端/旧系统节奏：300ms 重发）
RESCAN_INTERVAL_S = 3.0      # 未连接时的重扫间隔（拔插即自动恢复）
READ_IDLE_DROP_S = 5.0       # 连接后持续无数据超过该时长 → 判定掉线
FIRST_FRAME_TIMEOUT_S = 4.0  # 手动选口：打开后这么久收不到完整帧 → 判定"这个口不是足垫"
WRITE_TIMEOUT_S = 0.5        # 写超时：没有对端的蓝牙 SPP 口会让 write 永久阻塞，必须设
MANUAL_CONNECT_WAIT_S = 12.0 # connect_manual 最长等待（开口 + 4s 身份 + 4s 首帧 + 余量）


def port_kind(p) -> str:
    """把一个串口归为 usb / bluetooth / other，Windows 与 macOS 判据不同：

    - Windows：hwid 里 "USB VID:PID=…" 是 USB 转串口，"BTHENUM" 是蓝牙 SPP 虚拟口；
    - macOS：hwid 多为 "n/a"，只能看设备名——/dev/cu.usbserial-* / cu.usbmodem* /
      cu.wchusbserial* 是 USB，/dev/cu.Bluetooth-Incoming-Port 是蓝牙，
      cu.debug-console / cu.wlan-debug 之类系统口归 other（打开后没数据，每个白等 4s）。
    """
    hwid = (p.hwid or "").upper()
    dev = (p.device or "").lower()
    if "BTHENUM" in hwid or "bluetooth" in dev:
        return "bluetooth"
    if "USB" in hwid or "usbserial" in dev or "usbmodem" in dev or "wchusbserial" in dev:
        return "usb"
    return "other"


def scan_order(ports):
    """扫描顺序：USB 串口（足垫是 CH343）优先，蓝牙虚拟口垫底。

    本机常挂着若干蓝牙 SPP 口，没有对端时 open 要阻塞 5s、write 会永久阻塞。
    排在前面会把整轮扫描拖死，扫描线程再也走不到足垫那个口。
    """
    order = {"usb": 0, "other": 1, "bluetooth": 2}
    return sorted(ports, key=lambda p: (order[port_kind(p)], p.device))


def normalize_device_code(value) -> str:
    """归一化设备码：兼容 'Unique ID: xxx--Versions:yyy' 原始回复 / 裸码 / '码:foot1' 旧格式。"""
    if not value:
        return ""
    text = str(value).strip().upper()
    tagged = re.search(r"UNIQUE\s+ID:\s*([A-Z0-9]+)", text, re.I)
    if tagged:
        return tagged.group(1).upper()
    text = re.sub(r"^UNIQUE\s+ID:\s*", "", text, flags=re.I)
    text = re.split(r"--|VERSIONS\s*:|COMPANY\s*:|\r|\n", text, flags=re.I)[0] or text
    m = re.search(r"[A-Z0-9]+", text)
    return m.group(0) if m else ""


def _describe_open_error(dev: str, exc: Exception) -> str:
    """把 pyserial 的打开异常翻成用户看得懂的一句话。"""
    msg = str(exc)
    low = msg.lower()
    if "permissionerror" in low or "access is denied" in low or "拒绝访问" in msg or "in use" in low:
        return f"{dev} 被其他程序占用，请关闭正在使用该串口的软件后重试"
    if "filenotfounderror" in low or "could not open port" in low or "找不到" in msg:
        return f"找不到 {dev}，设备可能已拔出，请刷新端口列表"
    return f"无法打开 {dev}：{msg}"


class SerialBridge:
    """后台线程扫描/读帧；订阅者（WebSocket 会话）通过 asyncio.Queue 收帧与状态。"""

    def __init__(self):
        cfg = _load_config()
        self._lock = threading.Lock()
        self._subscribers = []  # [(asyncio.Queue, asyncio.AbstractEventLoop)]
        self._stop = False
        self._ser = None
        self.state = "disconnected"  # disconnected | scanning | connected
        self.port_name = None
        self.device_code = _resolve_device_code(cfg)
        self.preferred_port = str(cfg.get("preferredPort") or "") or None
        self._thread = None

        # ── 手动选口 ──
        self.mode = "auto"           # auto | manual
        self._manual_port = None     # 用户指定的口；非空时扫描只试它
        self._seq = 0                # 请求序号：手动请求/回自动一到，正在跑的扫描/读帧循环立即让路
        self._wake = threading.Event()
        self._frames_ok = False      # 当前连接是否已收到过完整帧（手动模式据此判"真是足垫"）
        self.last_identity = None    # 当前/最近连接口读到的设备码（可能与登记码不同）
        self.last_error = None       # 最近一次手动连接的失败原因

    # ── 生命周期 ──────────────────────────────────────────────────────────
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._run, name="serial-bridge", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop = True
        self._wake.set()

    def status(self) -> dict:
        identity = self.last_identity
        return {
            "state": self.state,
            "port": self.port_name,
            "deviceCode": self.device_code,
            "mode": self.mode,
            "identity": identity,
            "identityMatch": bool(identity) and normalize_device_code(identity) == normalize_device_code(self.device_code),
            "preferredPort": self.preferred_port,
            "error": self.last_error,
        }

    # ── 手动兜底：列口 / 指定口连接 / 登记设备码 / 回自动 ─────────────────────
    def list_ports(self) -> list:
        """全部 COM 口（按自动扫描顺序：USB 优先、蓝牙垫底），给前端选口弹窗用。"""
        out = []
        for p in scan_order(serial.tools.list_ports.comports()):
            kind = port_kind(p)
            out.append({
                "device": p.device,
                "description": p.description or "",
                "hwid": p.hwid or "",
                "usb": kind == "usb",
                "bluetooth": kind == "bluetooth",
                "preferred": p.device == self.preferred_port,
                "current": self.state == "connected" and p.device == self.port_name,
            })
        return out

    def connect_manual(self, dev: str, timeout: float = MANUAL_CONNECT_WAIT_S) -> dict:
        """
        只开指定的口。阻塞等结果：收到完整帧 → ok；打不开 / 无帧 → 带原因的失败。
        不校验设备码——这是给"码对不上"的场景兜底的；码是否匹配随结果返回，由前端决定是否登记。
        """
        dev = str(dev or "").strip()
        if not dev:
            return {"ok": False, "error": "未指定端口"}
        self.last_error = None
        self._manual_port = dev
        self._seq += 1
        seq = self._seq
        self._wake.set()  # 正在睡 3s 重扫间隔的话立即醒来

        deadline = time.time() + timeout
        while time.time() < deadline and not self._stop:
            if self._seq != seq:
                return {"ok": False, "error": "已被新的连接请求取代"}
            if self.last_error:
                return {"ok": False, "error": self.last_error}
            if self.state == "connected" and self.port_name == dev and self._frames_ok:
                self._remember_port(dev)
                return {"ok": True, **self.status()}
            time.sleep(0.1)
        # 超时：让桥回到自动模式，别一直吊着这个口
        if self._manual_port == dev:
            self._manual_port = None
            self.mode = "auto"
            self._seq += 1
            self._wake.set()
        return {"ok": False, "error": f"连接 {dev} 超时，未收到足垫数据"}

    def set_device_code(self, code: str) -> str:
        """登记新的默认设备码（落盘）。传空则不动，抛 ValueError。"""
        norm = normalize_device_code(code)
        if not norm:
            raise ValueError("设备码为空")
        self.device_code = norm
        cfg = _load_config()
        cfg["deviceCode"] = norm
        _save_config(cfg)
        # 当前手动连着的正是这块垫子 → 它现在就是"登记设备"了，模式回归自动
        if self.state == "connected" and self.last_identity and normalize_device_code(self.last_identity) == norm:
            self.mode = "auto"
            self._manual_port = None
        self._publish({"type": "status", **self.status()})
        return norm

    def clear_manual(self) -> dict:
        """放弃手动指定，回到自动扫描。"""
        self._manual_port = None
        self.mode = "auto"
        self.last_error = None
        self._seq += 1
        self._wake.set()
        return self.status()

    def _remember_port(self, dev: str) -> None:
        if self.preferred_port == dev:
            return
        self.preferred_port = dev
        cfg = _load_config()
        cfg["preferredPort"] = dev
        _save_config(cfg)

    # ── 订阅（WebSocket 会话调用；跨线程投递用各自的 loop） ────────────────
    def subscribe(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        with self._lock:
            self._subscribers.append((queue, loop))

    def unsubscribe(self, queue: asyncio.Queue):
        with self._lock:
            self._subscribers = [(q, l) for (q, l) in self._subscribers if q is not queue]

    def _publish(self, item):
        """读线程 → 各订阅者事件循环。队列满时丢最旧帧（保实时，不积压）。"""
        with self._lock:
            subs = list(self._subscribers)
        for queue, loop in subs:
            def _put(q=queue, it=item):
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(it)
            try:
                loop.call_soon_threadsafe(_put)
            except RuntimeError:
                pass  # 会话所在 loop 已关闭，unsubscribe 会随之清理

    def _set_state(self, state, port=None):
        self.state = state
        self.port_name = port
        self._publish({"type": "status", **self.status()})

    # ── 主循环：未连接就扫描，连接后读帧 ──────────────────────────────────
    def _run(self):
        while not self._stop:
            seq = self._seq
            try:
                connected = self._scan_and_connect(seq)
                if connected:
                    self._read_frames(seq)  # 阻塞直到掉线/停止/被新请求打断
            except Exception as exc:  # 扫描/读取的意外错误：记录后照常重试
                print(f"[bridge] unexpected error: {exc}")
            self._close_port()
            if not self._stop:
                self._set_state("disconnected")
                # 可被手动请求唤醒：不用干等 3s
                self._wake.wait(RESCAN_INTERVAL_S)
                self._wake.clear()

    def _close_port(self):
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
            self._ser = None
        self._frames_ok = False

    def _scan_and_connect(self, seq: int) -> bool:
        """扫描全部 COM 口，逐个 AT 查询设备码，匹配登记足垫后锁定。手动模式只试指定口。"""
        manual = self._manual_port
        if manual:
            return self._connect_manual_port(manual, seq)

        self.mode = "auto"
        # 上一次手动连接的失败原因只服务于那一次请求（connect_manual 已经在 100ms 内读走）；
        # 新一轮自动扫描开始就清掉，别让 /device/status 一直挂着过期的错误
        self.last_error = None
        self._set_state("scanning")
        ports = [p.device for p in scan_order(serial.tools.list_ports.comports())]
        # 上次手动连成功的口优先：换了设备码没登记也能少扫几个口
        if self.preferred_port in ports:
            ports.remove(self.preferred_port)
            ports.insert(0, self.preferred_port)
        print(f"[bridge] scanning ports: {ports}")
        for dev in ports:
            if self._stop or self._seq != seq:
                return False
            try:
                ser = serial.Serial(dev, BAUD_RATE, timeout=0.2, write_timeout=WRITE_TIMEOUT_S)
            except Exception as exc:
                print(f"[bridge] {dev} open failed: {exc}")
                continue
            uid = self._query_identity(ser, seq)
            if uid and normalize_device_code(uid) == normalize_device_code(self.device_code):
                print(f"[bridge] {dev} matched device {uid}")
                self._ser = ser
                self.last_identity = uid
                self._set_state("connected", dev)
                return True
            print(f"[bridge] {dev} identity={uid!r} (no match)")
            try:
                ser.close()
            except Exception:
                pass
        return False

    def _connect_manual_port(self, dev: str, seq: int) -> bool:
        """手动模式：只开这一个口。打不开 → 记错误并回自动；能开 → 读码后直接进读帧由首帧校验。"""
        self.mode = "manual"
        self._set_state("scanning")
        print(f"[bridge] manual connect: {dev}")
        try:
            ser = serial.Serial(dev, BAUD_RATE, timeout=0.2, write_timeout=WRITE_TIMEOUT_S)
        except Exception as exc:
            self.last_error = _describe_open_error(dev, exc)
            print(f"[bridge] {self.last_error}")
            self._manual_port = None
            self.mode = "auto"
            return False
        uid = self._query_identity(ser, seq)
        if self._seq != seq:
            ser.close()
            return False
        self.last_identity = uid
        match = bool(uid) and normalize_device_code(uid) == normalize_device_code(self.device_code)
        print(f"[bridge] {dev} manual identity={uid!r} match={match}")
        self._ser = ser
        self._set_state("connected", dev)
        return True

    def _query_identity(self, ser, seq: int | None = None) -> str | None:
        """每 300ms 发 AT 指令，从流中（可能夹在 4096B 帧之间）解析 Unique ID。"""
        buf = b""
        last_send = 0.0
        deadline = time.time() + IDENTITY_TIMEOUT_S
        while time.time() < deadline and not self._stop:
            if seq is not None and self._seq != seq:
                return None  # 被新请求打断
            now = time.time()
            if now - last_send >= 0.3:
                try:
                    ser.write(AT_QUERY)
                except Exception:
                    return None
                last_send = now
            try:
                chunk = ser.read(4096)
            except Exception:
                return None
            if chunk:
                buf += chunk
                m = re.search(rb"Unique\s+ID:\s*([A-Za-z0-9]+)", buf, re.I)
                if m:
                    return m.group(1).decode("ascii", "replace")
                buf = buf[-8192:]  # 只留尾部窗口
        return None

    def _read_frames(self, seq: int):
        """持续读帧并推送订阅者；分隔符 AA 55 03 99，其前 4096 字节为一帧。"""
        ser = self._ser
        manual = self.mode == "manual"
        buf = b""
        started = time.time()
        last_data = started
        while not self._stop and ser is not None:
            if self._seq != seq:
                return  # 用户换了口 / 切回自动：让路
            try:
                chunk = ser.read(8192)
            except Exception as exc:
                print(f"[bridge] read error ({self.port_name}): {exc}")
                return  # 掉线 → 主循环重扫
            if chunk:
                last_data = time.time()
                buf += chunk
                while True:
                    idx = buf.find(FRAME_FOOTER)
                    if idx < 0:
                        if len(buf) > FRAME_SIZE * 3:
                            buf = buf[-FRAME_SIZE * 2:]
                        break
                    if idx >= FRAME_SIZE:
                        self._publish(bytes(buf[idx - FRAME_SIZE:idx]))
                        if not self._frames_ok:
                            self._frames_ok = True
                            self._publish({"type": "status", **self.status()})
                    buf = buf[idx + len(FRAME_FOOTER):]
            elif manual and not self._frames_ok and time.time() - started > FIRST_FRAME_TIMEOUT_S:
                # 手动选的口能打开、却始终没有带分隔符的完整帧 → 大概率不是足垫，明确报错并回自动
                self.last_error = f"{self.port_name} 已打开但收不到足垫数据帧，这个口可能不是足垫"
                print(f"[bridge] {self.last_error}")
                self._manual_port = None
                self.mode = "auto"
                return
            elif time.time() - last_data > READ_IDLE_DROP_S:
                print(f"[bridge] {self.port_name} idle > {READ_IDLE_DROP_S}s, reconnecting")
                return


bridge = SerialBridge()
