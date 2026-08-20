/**
 * deviceManager — 全局足垫连接管理（应用级单例，跨页面存活）。
 *
 * 两条连接路径，桥优先：
 *
 * 1) 串口桥（首选，零授权零弹窗）：Python 后端 serial_bridge.py 像旧交付系统
 *    serialServer.js 一样扫描电脑上全部 COM 口 → 发 "AT+NAME=ESP32" 查询
 *    "Unique ID:" 设备码 → 匹配登记足垫后持续读帧，经 WebSocket
 *    /device/stream 推给前端（二进制 4096B/帧，文本 JSON 为状态变化）。
 *    拔插自动重扫，前端只管订阅。
 *
 * 2) Web Serial（兜底，Python 后端没起时）：浏览器直连串口。同样的 AT 指令
 *    校验设备码；限制是首次必须用户手势授权一次端口（浏览器安全模型）。
 *
 * 连接状态通过 "aciki-device-status" 事件 + localStorage 广播，页面各自订阅。
 */
import {
  SerialService,
  normalizeDeviceCode,
  FRAME_FLIP_VERTICAL,
  FRAME_FLIP_HORIZONTAL,
} from "./SerialService";
import { broadcastException } from "@/components/ExceptionModal";

// 足垫设备码（设备 Unique ID）。旧系统登记格式为 "330005000251333232353831:foot1"，
// ":foot1" 是垫位槽号，现单垫方案已废弃，只保留设备码本身。
// Web Serial 兜底路径用它校验；桥路径的校验在后端（serial_bridge.py / ACIKI_DEVICE_CODE）。
// 换垫子可在 localStorage 写 aciki-device-code 覆盖（兜底路径），后端用环境变量覆盖。
const DEFAULT_FOOT_PAD_CODE = "330005000251333232353831";

export function expectedDeviceCode(): string {
  try {
    const override = window.localStorage.getItem("aciki-device-code");
    if (override?.trim()) return normalizeDeviceCode(override);
  } catch {
    /* localStorage 不可用时用默认码 */
  }
  return normalizeDeviceCode(DEFAULT_FOOT_PAD_CODE);
}

/** 广播设备连接状态（跨页面/跨标签页）：首页徽章、测量页按钮都靠它同步 */
export function broadcastDeviceStatus(connected: boolean) {
  try {
    window.localStorage.setItem("aciki-device-connected", connected ? "true" : "false");
    window.dispatchEvent(new CustomEvent("aciki-device-status", { detail: { connected } }));
  } catch {
    /* 忽略广播失败 */
  }
}

// 串口桥地址：与 backendApi 同一个 Python 服务（8766）。WS 不走 Vite 代理，直连最稳。
const BRIDGE_HTTP = "http://127.0.0.1:8766";
const BRIDGE_WS = "ws://127.0.0.1:8766/device/stream";
/** 桥状态探测超时：Python 未启动时 fetch 会快速失败，这里只是兜底 */
const BRIDGE_PROBE_TIMEOUT_MS = 2500;
/** autoConnect 等待桥完成一轮扫描的最长时间（扫描若干 COM 口 × 4s 身份超时） */
const BRIDGE_SCAN_WAIT_MS = 20000;
/** Web Serial 兜底：逐端口身份查询超时（同旧系统 300ms 重发节奏） */
const IDENTITY_TIMEOUT_MS = 4000;

type BridgeState = "unavailable" | "disconnected" | "scanning" | "connected";

class DeviceManager {
  /** Web Serial 兜底路径的串口服务（桥不可用时启用）；帧回调经本管理器统一分发 */
  readonly service = new SerialService();

  private onDataCb: ((frame: number[][]) => void) | null = null;
  private filterThreshold = 25;

  private ws: WebSocket | null = null;
  private wsRetryTimer: number | null = null;
  private bridgeState: BridgeState = "unavailable";
  private bridgeEnabled = false; // 桥探测成功后为 true：断开/重连都走桥
  private webSerialConnected = false;
  private busy: Promise<boolean> | null = null;

  constructor() {
    // Web Serial 路径：读取中断且非主动断开 = 意外掉线
    this.service.setOnError(() => {
      this.webSerialConnected = false;
      broadcastDeviceStatus(false);
      broadcastException("port-error");
    });
    this.service.setOnData((frame) => this.onDataCb?.(frame));
    if ("serial" in navigator) {
      // 已授权设备插入（或重新插上）→ 自动重连（仅兜底路径需要；桥自己会重扫）
      (navigator.serial as unknown as EventTarget).addEventListener?.("connect", () => {
        if (!this.bridgeEnabled) void this.autoConnect();
      });
    }
  }

  // ── 对页面暴露的统一接口 ────────────────────────────────────────────────
  setOnData(cb: ((frame: number[][]) => void) | null) {
    this.onDataCb = cb;
  }

  setFilterThreshold(v: number) {
    this.filterThreshold = Math.max(0, Math.min(255, v));
    this.service.filterThreshold = this.filterThreshold;
  }

  isConnected(): boolean {
    if (this.bridgeEnabled) return this.bridgeState === "connected";
    return this.webSerialConnected && this.service.getIsConnected();
  }

  /**
   * 自动连接：优先串口桥（后端扫全部 COM 口，零授权）；桥不可用（Python 未启动）
   * 回退 Web Serial 已授权端口。无匹配设备时安静返回 false（不弹窗）。
   */
  autoConnect(): Promise<boolean> {
    if (this.isConnected()) return Promise.resolve(true);
    if (this.busy) return this.busy;
    this.busy = this.doAutoConnect().finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async doAutoConnect(): Promise<boolean> {
    if (await this.tryBridge()) return true;
    if (this.bridgeEnabled) return false; // 桥可用但暂未发现设备：等桥自动重扫，不再碰 Web Serial
    return this.tryWebSerialPorts();
  }

  /**
   * 手动连接（"连接设备"按钮 / 开始体验）：
   * - 桥模式：桥常驻自动重扫，这里只是即时确认；没发现设备就抛错（上层弹"未连接"）。
   * - 兜底模式：先试已授权端口，仍不行弹浏览器授权框（需用户手势），授权后校验设备码。
   */
  async connectWithPrompt(): Promise<boolean> {
    if (await this.autoConnect()) return true;
    if (this.bridgeEnabled) {
      throw new Error("no device: bridge scanning, foot pad not found");
    }
    const port = await navigator.serial.requestPort();
    try {
      await this.service.connectPort(port);
      const id = await this.service.queryIdentity(IDENTITY_TIMEOUT_MS + 2000);
      const expected = expectedDeviceCode();
      if (id && id === expected) {
        this.webSerialConnected = true;
        broadcastDeviceStatus(true);
        return true;
      }
      await this.service.disconnect();
      throw new Error(
        id ? `设备码不匹配：期望 ${expected}，实际 ${id}` : "no device identity response",
      );
    } catch (err) {
      try {
        await this.service.disconnect();
      } catch {
        /* 已关闭 */
      }
      throw err;
    }
  }

  async disconnect() {
    if (this.bridgeEnabled) {
      this.closeStream();
      this.bridgeState = "disconnected";
      broadcastDeviceStatus(false);
      return;
    }
    await this.service.disconnect();
    this.webSerialConnected = false;
    broadcastDeviceStatus(false);
  }

  // ── 路径 1：串口桥 ──────────────────────────────────────────────────────
  /** 探测桥并建立帧流；等待桥完成一轮扫描，返回是否已连接足垫 */
  private async tryBridge(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), BRIDGE_PROBE_TIMEOUT_MS);
      const res = await fetch(`${BRIDGE_HTTP}/device/status`, { signal: ctrl.signal });
      window.clearTimeout(t);
      const status = (await res.json()) as { available?: boolean; state?: BridgeState };
      if (!status.available) return false;
      this.bridgeEnabled = true;
      this.bridgeState = status.state ?? "disconnected";
      this.openStream();
      if (this.bridgeState === "connected") {
        broadcastDeviceStatus(true);
        return true;
      }
      // 桥在扫描：等它出结果（connected / 一轮扫完仍 disconnected）
      return await this.waitBridgeSettled();
    } catch {
      return false; // Python 后端没起：桥不可用
    }
  }

  private waitBridgeSettled(): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (this.bridgeState === "connected") {
          window.clearInterval(timer);
          resolve(true);
        } else if (this.bridgeState === "disconnected" || Date.now() - started > BRIDGE_SCAN_WAIT_MS) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 200);
    });
  }

  /** 常驻帧流：二进制 = 帧，文本 = 状态 JSON。断开自动重连（桥进程重启场景）。 */
  private openStream() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(BRIDGE_WS);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; state?: BridgeState };
          if (msg.type === "status" && msg.state) this.applyBridgeState(msg.state);
        } catch {
          /* 非 JSON 文本忽略 */
        }
        return;
      }
      this.handleBridgeFrame(new Uint8Array(ev.data as ArrayBuffer));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.bridgeEnabled) {
        this.applyBridgeState("disconnected");
        // 桥进程可能在重启：5s 后重试
        this.wsRetryTimer = window.setTimeout(() => this.openStream(), 5000);
      }
    };
    ws.onerror = () => ws.close();
  }

  private closeStream() {
    if (this.wsRetryTimer !== null) {
      window.clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }
    const ws = this.ws;
    this.ws = null; // 先摘引用，onclose 里不再触发重连
    ws?.close();
  }

  private applyBridgeState(state: BridgeState) {
    const wasConnected = this.bridgeState === "connected";
    this.bridgeState = state;
    const nowConnected = state === "connected";
    broadcastDeviceStatus(nowConnected);
    // 采集中拔线等意外掉线：弹一次"连接异常"（桥会自动重扫恢复）
    if (wasConnected && !nowConnected) broadcastException("port-error");
  }

  /**
   * 桥帧：4096B 行优先 → 64×64 矩阵，套用与 SerialService 相同的底噪滤波。
   * FRAME_FLIP_*：真机帧方向校正（180° 旋转，传感器原点在显示坐标系对角；
   * 轴向详解见 SerialService 的开关注释）。
   * Web Serial 兜底路径（SerialService.processData）连同一台设备，改一起改。
   */
  private handleBridgeFrame(bytes: Uint8Array) {
    if (bytes.length !== 4096 || !this.onDataCb) return;
    const threshold = this.filterThreshold;
    const matrix: number[][] = [];
    for (let r = 0; r < 64; r++) {
      const srcRow = FRAME_FLIP_HORIZONTAL ? 63 - r : r;
      const row = new Array<number>(64);
      for (let c = 0; c < 64; c++) {
        const srcCol = FRAME_FLIP_VERTICAL ? 63 - c : c;
        const v = bytes[srcRow * 64 + srcCol];
        row[c] = v <= threshold ? 0 : v;
      }
      matrix.push(row);
    }
    this.onDataCb(matrix);
  }

  // ── 路径 2：Web Serial 兜底（Python 后端未启动时） ──────────────────────
  private async tryWebSerialPorts(): Promise<boolean> {
    if (!("serial" in navigator)) return false;
    const expected = expectedDeviceCode();
    let ports: SerialPort[] = [];
    try {
      // 个别环境 getPorts() 可能长时间不返回：3s 兜底成空列表，避免入口 UI 卡在"连接中"
      ports = await Promise.race([
        navigator.serial.getPorts(),
        new Promise<SerialPort[]>((resolve) => window.setTimeout(() => resolve([]), 3000)),
      ]);
    } catch {
      return false;
    }
    for (const port of ports) {
      try {
        await this.service.connectPort(port);
        const id = await this.service.queryIdentity(IDENTITY_TIMEOUT_MS);
        if (id && id === expected) {
          this.webSerialConnected = true;
          broadcastDeviceStatus(true);
          return true;
        }
        await this.service.disconnect();
      } catch {
        // 端口占用/打开失败 → 试下一个
        try {
          await this.service.disconnect();
        } catch {
          /* 已关闭 */
        }
      }
    }
    return false;
  }
}

export const deviceManager = new DeviceManager();
