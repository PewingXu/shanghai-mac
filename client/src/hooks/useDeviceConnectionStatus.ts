/**
 * 设备连接状态（共享 hook）
 *
 * 唯一真实来源是 lib/deviceManager：它按连接路径判定 isConnected()（串口桥看
 * bridgeState，Web Serial 兜底看 webSerialConnected && service.getIsConnected()），
 * 状态一变就 broadcastDeviceStatus() —— 写 localStorage['aciki-device-connected']
 * 并派发 'aciki-device-status' 事件。本 hook 只做订阅，不自己判断。
 *
 * 两条注意（都踩过）：
 *  1. 初值/兜底一律用 stored === 'true'。若写成 !== 'false'，键从未写过（全新浏览器、
 *     还没连过设备）时值为 null，会误报「设备连接正常」，与首页显示互相矛盾。
 *  2. 不能用 navigator.serial.getPorts() 判断——它返回的是「曾授权过」的串口，
 *     不代表当前已连接，同样会误报。
 *
 * storage 事件只在别的标签页写入时触发，故同标签页依赖 CustomEvent，两者都要订阅。
 */
import { useEffect, useState } from 'react';
import { deviceManager } from '@/lib/deviceManager';

export function useDeviceConnectionStatus(): boolean {
  const [connected, setConnected] = useState(() => deviceManager.isConnected());

  useEffect(() => {
    const applyStored = () => {
      const stored = window.localStorage.getItem('aciki-device-connected');
      setConnected(stored === 'true');
    };
    // 挂载时先对齐一次：可能在本组件挂载前就已连上/掉线
    setConnected(deviceManager.isConnected() || window.localStorage.getItem('aciki-device-connected') === 'true');

    const handleCustomStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ connected?: boolean }>).detail;
      if (typeof detail?.connected === 'boolean') setConnected(detail.connected);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'aciki-device-connected') applyStored();
    };

    window.addEventListener('aciki-device-status', handleCustomStatus);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('aciki-device-status', handleCustomStatus);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return connected;
}
