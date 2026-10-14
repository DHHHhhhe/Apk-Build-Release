import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate
} from '../services/update/updater'

export function setupUpdateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE.GET_STATE, () => getUpdateState())
  // 渲染层点「检查更新」= 手动检查，结果要显式说出来（自动检查则保持安静）
  ipcMain.handle(IPC_CHANNELS.UPDATE.CHECK, () => checkForUpdates(true))
  ipcMain.handle(IPC_CHANNELS.UPDATE.DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IPC_CHANNELS.UPDATE.INSTALL, () => {
    installUpdate()
  })
}
