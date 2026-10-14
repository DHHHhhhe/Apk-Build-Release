import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate
} from '../services/update/updater'
import { takeLaunchNotice } from '../services/update/lib/launch-notice'

export function setupUpdateHandlers(): void {
  // 取一次就没了：同一版反复启动不该每次都说「已更新到」
  ipcMain.handle(IPC_CHANNELS.UPDATE.TAKE_LAUNCH_NOTICE, () => takeLaunchNotice())
  ipcMain.handle(IPC_CHANNELS.UPDATE.GET_STATE, () => getUpdateState())
  // 渲染层点「检查更新」= 手动检查，结果要显式说出来（自动检查则保持安静）
  ipcMain.handle(IPC_CHANNELS.UPDATE.CHECK, () => checkForUpdates(true))
  ipcMain.handle(IPC_CHANNELS.UPDATE.DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IPC_CHANNELS.UPDATE.INSTALL, () => {
    installUpdate()
  })
}
