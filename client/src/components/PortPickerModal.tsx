/**
 * PortPickerModal — 手动选 COM 口兜底（串口桥模式专用）。
 *
 * 自动扫描匹配不上时（换了新足垫设备码不同 / 固件不回 AT 身份 / 口被短暂占用），
 * 列出电脑上全部 COM 口让用户点一个直接连。连上后若读到的设备码与登记码不同，
 * 提示一键登记为默认设备——下次开机自动扫描就能命中，手动选口只需做一次。
 */
import { useCallback, useEffect, useState } from "react";
import { deviceManager, type BridgePort, type ManualConnectResult } from "@/lib/deviceManager";

type Phase =
  | { kind: "list" }
  | { kind: "connecting"; port: string }
  | { kind: "failed"; port: string; error: string }
  | { kind: "register"; result: ManualConnectResult }
  | { kind: "noIdentity"; result: ManualConnectResult };

export default function PortPickerModal({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const [ports, setPorts] = useState<BridgePort[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "list" });
  const [registering, setRegistering] = useState(false);

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      setPorts(await deviceManager.listPorts());
    } catch (err) {
      setPorts([]);
      setListError(`读取端口列表失败：${String((err as Error)?.message ?? err)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (dev: string) => {
    setPhase({ kind: "connecting", port: dev });
    try {
      const r = await deviceManager.connectManual(dev);
      if (!r.ok) {
        setPhase({ kind: "failed", port: dev, error: r.error ?? "连接失败" });
        return;
      }
      if (r.identityMatch) {
        onConnected?.();
        onClose();
        return;
      }
      setPhase(r.identity ? { kind: "register", result: r } : { kind: "noIdentity", result: r });
    } catch (err) {
      setPhase({ kind: "failed", port: dev, error: String((err as Error)?.message ?? err) });
    }
  };

  const register = async (code: string) => {
    setRegistering(true);
    try {
      await deviceManager.registerDeviceCode(code);
      onConnected?.();
      onClose();
    } catch (err) {
      setPhase({ kind: "failed", port: "", error: `登记失败：${String((err as Error)?.message ?? err)}` });
    } finally {
      setRegistering(false);
    }
  };

  const usbPorts = (ports ?? []).filter((p) => !p.bluetooth);
  const btPorts = (ports ?? []).filter((p) => p.bluetooth);

  return (
    <div className="pp-overlay" onClick={onClose}>
      <div className="pp-card" role="dialog" aria-label="手动选择串口" onClick={(e) => e.stopPropagation()}>
        <div className="pp-head">
          <div>
            <h2>手动选择串口</h2>
            <p>自动扫描没有找到已登记的足垫。请选择足垫所在的 COM 口，通常是 USB 串口（CH343）。</p>
          </div>
          <button type="button" className="pp-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {phase.kind === "list" || phase.kind === "failed" ? (
          <>
            {phase.kind === "failed" && (
              <div className="pp-alert" role="alert">
                {phase.error}
              </div>
            )}
            <div className="pp-list-head">
              <span>{ports === null ? "正在读取端口…" : `共 ${ports.length} 个端口`}</span>
              <button type="button" className="pp-link" onClick={() => void refresh()}>
                刷新
              </button>
            </div>
            {listError && <div className="pp-alert">{listError}</div>}
            <div className="pp-list">
              {ports !== null && ports.length === 0 && !listError && (
                <div className="pp-empty">没有检测到任何串口。请确认足垫已用 USB 线接到电脑，并已安装 CH343 驱动。</div>
              )}
              {usbPorts.map((p) => (
                <PortRow key={p.device} port={p} onPick={() => void connect(p.device)} />
              ))}
              {btPorts.length > 0 && (
                <div className="pp-group">蓝牙虚拟串口（足垫一般不在这里）</div>
              )}
              {btPorts.map((p) => (
                <PortRow key={p.device} port={p} onPick={() => void connect(p.device)} dim />
              ))}
            </div>
          </>
        ) : phase.kind === "connecting" ? (
          <div className="pp-status">
            <span className="pp-spinner" aria-hidden="true" />
            <div>
              <b>正在连接 {phase.port}…</b>
              <p>读取设备码并等待数据帧，最长约 10 秒。</p>
            </div>
          </div>
        ) : phase.kind === "register" ? (
          <div className="pp-status pp-status-col">
            <b>已连上 {phase.result.port}，正在接收足垫数据</b>
            <p>
              这块足垫的设备码 <code>{phase.result.identity}</code> 与当前登记码 <code>{phase.result.deviceCode}</code> 不同。
              登记为默认设备后，下次开机会自动连接，不再需要手动选口。
            </p>
            <div className="pp-actions">
              <button type="button" className="pp-btn pp-btn-ghost" onClick={() => { onConnected?.(); onClose(); }} disabled={registering}>
                仅本次使用
              </button>
              <button type="button" className="pp-btn" onClick={() => void register(phase.result.identity ?? "")} disabled={registering}>
                {registering ? "登记中…" : "登记为默认设备"}
              </button>
            </div>
          </div>
        ) : (
          <div className="pp-status pp-status-col">
            <b>已连上 {phase.result.port}，正在接收足垫数据</b>
            <p>设备没有返回设备码，无法登记为默认设备；本次可正常测量，下次仍需手动选口。</p>
            <div className="pp-actions">
              <button type="button" className="pp-btn" onClick={() => { onConnected?.(); onClose(); }}>
                知道了
              </button>
            </div>
          </div>
        )}

        <style>{styles}</style>
      </div>
    </div>
  );
}

function PortRow({ port, onPick, dim }: { port: BridgePort; onPick: () => void; dim?: boolean }) {
  return (
    <button type="button" className={`pp-row${dim ? " is-dim" : ""}`} onClick={onPick}>
      <span className="pp-row-dev">{port.device}</span>
      <span className="pp-row-desc" title={port.hwid}>
        {port.description || "未知设备"}
      </span>
      <span className="pp-row-tags">
        {port.current && <em className="pp-tag pp-tag-on">当前连接</em>}
        {port.preferred && !port.current && <em className="pp-tag">上次使用</em>}
        {port.usb && <em className="pp-tag pp-tag-usb">USB</em>}
      </span>
      <span className="pp-row-go" aria-hidden="true">
        连接 ›
      </span>
    </button>
  );
}

const styles = `
  .pp-overlay {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(140,146,158,0.8);
    animation: pp-fade 160ms ease-out;
    font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  }
  .pp-card {
    width: min(640px, calc(100vw - 48px));
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    background: linear-gradient(180deg, #e5eeff 0%, #f1f6ff 100%);
    border: 1.5px solid #0A3997;
    box-shadow: 0 4px 6px #8897b5;
    box-sizing: border-box;
    padding: 28px 32px 24px;
    animation: pp-pop 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .pp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .pp-head h2 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.08em; color: #17191c; }
  .pp-head p { margin: 8px 0 0; font-size: 14px; line-height: 1.6; color: #3d4a66; }
  .pp-close { border: 0; background: transparent; font-size: 26px; line-height: 1; font-weight: 300; color: #929292; cursor: pointer; margin: -6px -8px 0 0; }

  .pp-alert {
    margin-top: 14px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(255,90,44,0.10);
    color: #d64545;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
  }
  .pp-list-head { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 8px; font-size: 13px; color: #58698b; }
  .pp-link { border: 0; background: transparent; color: #0A3997; font-weight: 700; font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .pp-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
  .pp-empty { padding: 24px 14px; text-align: center; font-size: 14px; color: #58698b; line-height: 1.6; }
  .pp-group { margin-top: 8px; font-size: 12px; color: #8c96ad; }

  .pp-row {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border: 1.5px solid rgba(10,57,151,0.18);
    border-radius: 12px;
    background: rgba(255,255,255,0.85);
    cursor: pointer;
    text-align: left;
    transition: border-color 140ms ease, transform 140ms ease, background 140ms ease;
  }
  .pp-row:hover { border-color: #0A3997; background: #fff; }
  .pp-row:active { transform: scale(0.99); }
  .pp-row.is-dim { opacity: 0.7; }
  .pp-row-dev { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; font-size: 16px; font-weight: 700; color: #0A3997; }
  .pp-row-desc { font-size: 13px; color: #2d3138; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-row-tags { display: flex; gap: 6px; }
  .pp-tag { font-style: normal; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(10,57,151,0.08); color: #0A3997; white-space: nowrap; }
  .pp-tag-on { background: rgba(58,210,163,0.18); color: #1f8f6a; }
  .pp-tag-usb { background: rgba(10,57,151,0.12); }
  .pp-row-go { font-size: 13px; font-weight: 700; color: #0A3997; white-space: nowrap; }

  .pp-status { display: flex; align-items: center; gap: 16px; margin-top: 24px; padding: 18px 16px; border-radius: 12px; background: rgba(255,255,255,0.85); }
  .pp-status-col { flex-direction: column; align-items: stretch; gap: 10px; }
  .pp-status b { font-size: 16px; color: #17191c; }
  .pp-status p { margin: 4px 0 0; font-size: 14px; line-height: 1.7; color: #3d4a66; }
  .pp-status code { font-family: "Inter", Consolas, monospace; font-size: 13px; padding: 1px 6px; border-radius: 6px; background: rgba(10,57,151,0.08); color: #0A3997; }
  .pp-spinner { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 3px solid rgba(10,57,151,0.18); border-top-color: #0A3997; animation: pp-spin 800ms linear infinite; }
  .pp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
  .pp-btn { min-width: 128px; height: 40px; padding: 0 18px; border: 0; border-radius: 10px; background: #0A3997; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; transition: transform 140ms ease, opacity 140ms ease; }
  .pp-btn:hover { opacity: 0.92; }
  .pp-btn:active { transform: scale(0.97); }
  .pp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pp-btn-ghost { background: rgba(255,255,255,0.7); color: #0A3997; border: 1.5px solid rgba(10,57,151,0.35); }

  @keyframes pp-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pp-pop { from { opacity: 0; transform: translateY(8px) scale(0.96); } to { opacity: 1; transform: none; } }
  @keyframes pp-spin { to { transform: rotate(360deg); } }
`;
