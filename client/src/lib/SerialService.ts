export type BaudRate = 3000000 | 6000000;

// 设备身份查询指令（同旧交付系统 serialServer.js 的 portWirte）："AT+NAME=ESP32\r\n"
// 设备收到后在数据流中回复文本 "Unique ID: <设备码> ... Versions: ..."
const ID_QUERY_COMMAND = new Uint8Array([
  0x41, 0x54, 0x2b, 0x4e, 0x41, 0x4d, 0x45, 0x3d, 0x45, 0x53, 0x50, 0x33, 0x32, 0x0d, 0x0a,
]);

/**
 * 归一化设备码：兼容 "Unique ID: xxx--Versions:yyy" 原始回复、裸设备码、
 * 以及旧系统 "设备码:foot1" 带槽位后缀的登记格式（槽位已废弃，只取设备码本身）。
 */
export function normalizeDeviceCode(value: string | null | undefined): string {
  if (!value) return "";
  let text = String(value).trim().toUpperCase();
  const tagged = text.match(/UNIQUE\s+ID:\s*([A-Z0-9]+)/i);
  if (tagged?.[1]) return tagged[1].toUpperCase();
  text = text.replace(/^UNIQUE\s+ID:\s*/i, "");
  text = text.split(/--|VERSIONS\s*:|COMPANY\s*:|\r|\n/i)[0] || text;
  const m = text.match(/[A-Z0-9]+/);
  return m ? m[0] : "";
}

export class SerialService {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private isConnected: boolean = false;
  private onDataCallback: ((data: number[][]) => void) | null = null;
  private onLogCallback: ((log: string, type?: 'info' | 'error' | 'data') => void) | null = null;
  // 意外掉线回调（读取中断且非用户主动断开时触发）
  private onErrorCallback: (() => void) | null = null;
  private closing: boolean = false;
  
  // New property to control mirroring
  public enableMirroring: boolean = true;
  
  // 滤波阈值，小于等于此值的数据置为0（默认25：过滤初始底噪）
  public filterThreshold: number = 25;

  // 波特率，默认3000000，可切换为6000000
  public baudRate: BaudRate = 3000000;

  // 64x64 matrix size (updated from 32x32)
  private readonly ROWS = 64;
  private readonly COLS = 64;
  private readonly DATA_SIZE = 64 * 64; // 4096 bytes
  
  // Frame Footer: AA 55 03 99
  private readonly FOOTER = new Uint8Array([0xAA, 0x55, 0x03, 0x99]);
  private readonly FRAME_SIZE = 4096 + 4; // Data + Footer (4100 bytes total)
  
  private buffer: Uint8Array = new Uint8Array(0);
  private frameCount = 0;
  private lastBufferLogTime = 0;

  // 设备身份探测（仅 queryIdentity 期间激活）：从二进制流中提取 "Unique ID: xxx" 文本回复
  private idProbeActive = false;
  private idProbeText = "";
  private idProbeDecoder = new TextDecoder("latin1");
  private onIdentityFound: ((code: string) => void) | null = null;

  constructor() {
    if (!('serial' in navigator)) {
      console.error('Web Serial API not supported in this browser.');
    }
  }

  setOnError(callback: (() => void) | null) {
    this.onErrorCallback = callback;
  }

  async connect() {
    // 不再吞掉错误：抛给调用方，用于区分"未连接/端口占用/连接异常"三种弹窗
    const port = await navigator.serial.requestPort();
    return this.connectPort(port);
  }

  /** 打开指定端口并启动读取（自动连接用：navigator.serial.getPorts() 返回的已授权端口） */
  async connectPort(port: SerialPort) {
    this.closing = false;
    this.port = port;
    this.log(`Port selected, opening with baudRate ${this.baudRate}...`);
    await this.port.open({ baudRate: this.baudRate });
    this.isConnected = true;
    this.frameCount = 0;
    this.buffer = new Uint8Array(0);
    this.log(`Port opened successfully at ${this.baudRate} baud.`);
    this.readLoop();
    return true;
  }

  /** 向设备写一条指令（一次性 writer，避免长期占用 writable 锁） */
  private async writeBytes(bytes: Uint8Array) {
    if (!this.port?.writable) throw new Error("Port not writable");
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  /**
   * 查询设备身份码：反复发送 AT 指令（同旧系统 300ms 一次），从数据流中
   * 捕获 "Unique ID: xxx" 回复。返回归一化设备码；超时返回 null。
   */
  async queryIdentity(timeoutMs = 5000): Promise<string | null> {
    if (!this.port || !this.isConnected) return null;
    this.idProbeActive = true;
    this.idProbeText = "";
    return new Promise<string | null>((resolve) => {
      let poller: number | undefined;
      let timer: number | undefined;
      const finish = (code: string | null) => {
        window.clearInterval(poller);
        window.clearTimeout(timer);
        this.idProbeActive = false;
        this.idProbeText = "";
        this.onIdentityFound = null;
        if (code) this.log(`Device identity: ${code}`);
        else this.log("Device identity query timed out", "error");
        resolve(code);
      };
      this.onIdentityFound = (code) => finish(code);
      const send = () => {
        this.writeBytes(ID_QUERY_COMMAND).catch((err) => this.log(`ID query write failed: ${err}`, "error"));
      };
      send();
      poller = window.setInterval(send, 300);
      timer = window.setTimeout(() => finish(null), timeoutMs);
    });
  }

  async disconnect() {
    this.closing = true; // 标记为用户主动断开，避免触发"意外掉线"弹窗
    if (this.reader) {
      await this.reader.cancel();
      this.reader = null;
    }
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    this.isConnected = false;
    this.buffer = new Uint8Array(0);
    this.frameCount = 0;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  setBaudRate(rate: BaudRate) {
    this.baudRate = rate;
    this.log(`Baud rate set to ${rate}. Reconnect to apply.`);
  }

  getBaudRate(): BaudRate {
    return this.baudRate;
  }

  setOnData(callback: ((data: number[][]) => void) | null) {
    this.onDataCallback = callback;
  }

  setOnLog(callback: (log: string, type?: 'info' | 'error' | 'data') => void) {
    this.onLogCallback = callback;
  }

  // New method to toggle mirroring
  setMirroring(enabled: boolean) {
      this.enableMirroring = enabled;
      this.log(`Sensor reordering ${enabled ? 'enabled' : 'disabled'}`);
  }

  // 设置滤波阈值
  setFilterThreshold(threshold: number) {
      this.filterThreshold = Math.max(0, Math.min(255, threshold));
      this.log(`Filter threshold set to ${this.filterThreshold}`);
  }

  // 获取当前滤波阈值
  getFilterThreshold(): number {
      return this.filterThreshold;
  }

  private log(message: string, type: 'info' | 'error' | 'data' = 'info') {
    if (this.onLogCallback) {
      this.onLogCallback(message, type);
    }
    console.log(`[Serial] ${message}`);
  }

  private async readLoop() {
    if (!this.port || !this.port.readable) return;

    this.reader = this.port.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.log('Starting read loop for 64x64 sensor...');

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) {
          this.log('Read loop done signal received.');
          if (!this.closing) {
            this.isConnected = false;
            this.onErrorCallback?.();
          }
          break;
        }
        if (value) {
          // Debug: Log first 8 bytes of every chunk to verify protocol
          const hex = Array.from(value.slice(0, 8))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(' ');
          this.log(`Rx ${value.length}B: ${hex}...`, 'data');
          
          this.processData(value);
        }
      }
    } catch (error) {
      this.log(`Error reading: ${error}`, 'error');
      if (!this.closing) {
        this.isConnected = false;
        this.onErrorCallback?.();
      }
    } finally {
      this.reader?.releaseLock();
      this.log('Reader lock released.');
    }
  }

  /** 身份探测：把最近的字节流当文本扫描 "Unique ID: xxx"（回复可能跨 chunk / 夹在数据帧之间） */
  private probeIdentity(chunk: Uint8Array) {
    this.idProbeText += this.idProbeDecoder.decode(chunk, { stream: true });
    const m = this.idProbeText.match(/Unique\s+ID:\s*([A-Za-z0-9]+)/i);
    if (m?.[1]) {
      this.onIdentityFound?.(normalizeDeviceCode(m[1]));
      return;
    }
    // 只保留尾部窗口，防止长时间探测累积内存
    if (this.idProbeText.length > 8192) {
      this.idProbeText = this.idProbeText.slice(-4096);
    }
  }

  private processData(chunk: Uint8Array) {
    if (this.idProbeActive) this.probeIdentity(chunk);

    // Append new chunk to buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    // Periodically log buffer status for debugging
    const now = Date.now();
    if (now - this.lastBufferLogTime > 2000) {
      this.lastBufferLogTime = now;
      // Scan buffer for any occurrence of footer bytes
      let footerFound = false;
      let footerPositions: number[] = [];
      for (let i = 0; i <= this.buffer.length - 4; i++) {
        if (this.buffer[i] === 0xAA && this.buffer[i+1] === 0x55 &&
            this.buffer[i+2] === 0x03 && this.buffer[i+3] === 0x99) {
          footerFound = true;
          footerPositions.push(i);
        }
      }
      this.log(`[BUF] size=${this.buffer.length}, footers=${footerFound ? footerPositions.join(',') : 'NONE'}, frames=${this.frameCount}`, 'info');
    }

    // Search for frame footer and process
    while (this.buffer.length >= this.FRAME_SIZE) {
      // Look for footer
      let footerIndex = -1;
      
      for (let i = 0; i <= this.buffer.length - 4; i++) {
        if (this.buffer[i] === this.FOOTER[0] &&
            this.buffer[i+1] === this.FOOTER[1] &&
            this.buffer[i+2] === this.FOOTER[2] &&
            this.buffer[i+3] === this.FOOTER[3]) {
          
          // Found a footer candidate
          if (i >= this.DATA_SIZE) {
             footerIndex = i;
             break;
          } else {
            this.log(`[FRAME] Footer at pos ${i} but only ${i} bytes before (need ${this.DATA_SIZE}), skipping`, 'info');
          }
        }
      }

      if (footerIndex === -1) {
        if (this.buffer.length > this.FRAME_SIZE * 3) {
           const trimTo = this.FRAME_SIZE * 2;
           this.log(`[BUF] Trimming buffer from ${this.buffer.length} to ${trimTo}`, 'info');
           this.buffer = this.buffer.slice(this.buffer.length - trimTo);
        }
        break;
      }

      // Extract data payload (4096 bytes before footer)
      const frameStartIndex = footerIndex - this.DATA_SIZE;
      const dataPayload = this.buffer.slice(frameStartIndex, footerIndex);
      
      let wsPointData = Array.from(dataPayload);

      // Convert to 64x64 matrix for output with noise filtering
      const matrix: number[][] = [];
      let maxVal = 0;
      let minVal = 255;
      let nonZeroCount = 0;
      
      for (let r = 0; r < this.ROWS; r++) {
        const row: number[] = [];
        for (let c = 0; c < this.COLS; c++) {
          let val = wsPointData[r * this.COLS + c];
          
          // 滤波：小于等于阈值的数据置为0（去除底噪，例如默认 ADC≤25 视为噪声）
          if (val <= this.filterThreshold) {
            val = 0;
          }
          
          row.push(val);
          
          if (val > maxVal) maxVal = val;
          if (val < minVal && val > 0) minVal = val;
          if (val > 0) nonZeroCount++;
        }
        matrix.push(row);
      }

      this.frameCount++;
      
      if (nonZeroCount > 0) {
         this.log(`[FRAME #${this.frameCount}] 64x64: Max=${maxVal}, Min=${minVal}, NonZero=${nonZeroCount}`, 'data');
      } else {
         if (this.frameCount % 20 === 0) {
            this.log(`[FRAME #${this.frameCount}] 64x64: Empty (all zeros)`, 'data');
         }
      }

      // Emit data
      if (this.onDataCallback) {
        this.onDataCallback(matrix);
      }

      // Remove processed frame from buffer
      this.buffer = this.buffer.slice(footerIndex + 4);
    }
  }
}
