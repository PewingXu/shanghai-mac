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
"""

import asyncio
import os
import re
import threading
import time

import serial
import serial.tools.list_ports

# 足垫设备码（旧系统登记格式 "330005000251333232353831:foot1"，":foot1" 槽位已弃用）。
# 可用环境变量 ACIKI_DEVICE_CODE 覆盖，无需改代码。
DEVICE_CODE = os.environ.get("ACIKI_DEVICE_CODE", "330005000251333232353831").strip().upper()

BAUD_RATE = 3_000_000
AT_QUERY = bytes.fromhex("41542B4E414D453D45535033320d0a")  # "AT+NAME=ESP32\r\n"
FRAME_FOOTER = b"\xaa\x55\x03\x99"
FRAME_SIZE = 4096
IDENTITY_TIMEOUT_S = 4.0     # 单口身份查询超时（同前端/旧系统节奏：300ms 重发）
RESCAN_INTERVAL_S = 3.0      # 未连接时的重扫间隔（拔插即自动恢复）
READ_IDLE_DROP_S = 5.0       # 连接后持续无数据超过该时长 → 判定掉线
WRITE_TIMEOUT_S = 0.5        # 写超时：没有对端的蓝牙 SPP 口会让 write 永久阻塞，必须设


def scan_order(ports):
    """扫描顺序：USB 串口（足垫是 CH343）优先，蓝牙虚拟口垫底。

    本机常挂着若干 BTHENUM 蓝牙 SPP 口，没有对端时 open 要阻塞 5s、write 会永久
    阻塞。排在前面会把整轮扫描拖死，扫描线程再也走不到足垫那个口。
    """
    def rank(p):
        hwid = (p.hwid or "").upper()
        if "BTHENUM" in hwid:
            return 2
        return 0 if "USB" in hwid else 1

    return sorted(ports, key=lambda p: (rank(p), p.device))


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


class SerialBridge:
    """后台线程扫描/读帧；订阅者（WebSocket 会话）通过 asyncio.Queue 收帧与状态。"""

    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers = []  # [(asyncio.Queue, asyncio.AbstractEventLoop)]
        self._stop = False
        self._ser = None
        self.state = "disconnected"  # disconnected | scanning | connected
        self.port_name = None
        self.device_code = DEVICE_CODE
        self._thread = None

    # ── 生命周期 ──────────────────────────────────────────────────────────
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._run, name="serial-bridge", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop = True

    def status(self) -> dict:
        return {"state": self.state, "port": self.port_name, "deviceCode": self.device_code}

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
            try:
                connected = self._scan_and_connect()
                if connected:
                    self._read_frames()  # 阻塞直到掉线/停止
            except Exception as exc:  # 扫描/读取的意外错误：记录后照常重试
                print(f"[bridge] unexpected error: {exc}")
            self._close_port()
            if not self._stop:
                self._set_state("disconnected")
                time.sleep(RESCAN_INTERVAL_S)

    def _close_port(self):
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:
                pass
            self._ser = None

    def _scan_and_connect(self) -> bool:
        """扫描全部 COM 口，逐个 AT 查询设备码，匹配登记足垫后锁定。"""
        self._set_state("scanning")
        ports = [p.device for p in scan_order(serial.tools.list_ports.comports())]
        print(f"[bridge] scanning ports: {ports}")
        for dev in ports:
            if self._stop:
                return False
            try:
                ser = serial.Serial(dev, BAUD_RATE, timeout=0.2, write_timeout=WRITE_TIMEOUT_S)
            except Exception as exc:
                print(f"[bridge] {dev} open failed: {exc}")
                continue
            uid = self._query_identity(ser)
            if uid and normalize_device_code(uid) == normalize_device_code(DEVICE_CODE):
                print(f"[bridge] {dev} matched device {uid}")
                self._ser = ser
                self._set_state("connected", dev)
                return True
            print(f"[bridge] {dev} identity={uid!r} (no match)")
            try:
                ser.close()
            except Exception:
                pass
        return False

    def _query_identity(self, ser) -> str | None:
        """每 300ms 发 AT 指令，从流中（可能夹在 4096B 帧之间）解析 Unique ID。"""
        buf = b""
        last_send = 0.0
        deadline = time.time() + IDENTITY_TIMEOUT_S
        while time.time() < deadline and not self._stop:
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

    def _read_frames(self):
        """持续读帧并推送订阅者；分隔符 AA 55 03 99，其前 4096 字节为一帧。"""
        ser = self._ser
        buf = b""
        last_data = time.time()
        while not self._stop and ser is not None:
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
                    buf = buf[idx + len(FRAME_FOOTER):]
            elif time.time() - last_data > READ_IDLE_DROP_S:
                print(f"[bridge] {self.port_name} idle > {READ_IDLE_DROP_S}s, reconnecting")
                return


bridge = SerialBridge()
