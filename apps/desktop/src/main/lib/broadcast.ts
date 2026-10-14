import { BrowserWindow } from 'electron'

/** 把事件推给所有窗口；窗口已销毁时跳过 */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}
