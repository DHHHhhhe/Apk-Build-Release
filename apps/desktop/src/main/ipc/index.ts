import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { copyTextToClipboard } from './app.handler'
import { setupBuildHandlers } from './build.handler'
import { setupEnvHandlers } from './env.handler'
import { setupProjectHandlers } from './project.handler'
import { setupQueueHandlers } from './queue.handler'
import { setupSettingsHandlers } from './settings.handler'
import { setupUpdateHandlers } from './update.handler'

/** 统一注册所有 IPC handler；新增 domain 时在这里挂上 */
export function setupIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP.COPY_TEXT, (_event, text: string) => copyTextToClipboard(text))
  setupEnvHandlers()
  setupProjectHandlers()
  setupQueueHandlers()
  setupBuildHandlers()
  setupSettingsHandlers()
  setupUpdateHandlers()
}
