import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { readSettings } from '../services/settings/procedures/get'
import { openDirectory, clearLogs } from '../services/settings/procedures/paths'
import { pickOutputRoot } from '../services/settings/procedures/pick-output-dir'
import { updateOutputRoot } from '../services/settings/procedures/set-output-root'
import { updateTheme } from '../services/settings/procedures/set-theme'
import { updateAutoCheckUpdate } from '../services/settings/procedures/set-auto-check-update'

export function setupSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, () => readSettings())
  ipcMain.handle(IPC_CHANNELS.SETTINGS.SET_OUTPUT_ROOT, (_event, input: unknown) =>
    updateOutputRoot(input)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS.SET_THEME, (_event, input: unknown) => updateTheme(input))
  ipcMain.handle(IPC_CHANNELS.SETTINGS.SET_AUTO_CHECK_UPDATE, (_event, input: unknown) =>
    updateAutoCheckUpdate(input)
  )
  ipcMain.handle(IPC_CHANNELS.SETTINGS.PICK_OUTPUT_DIR, () => pickOutputRoot())
  ipcMain.handle(IPC_CHANNELS.SETTINGS.OPEN_PATH, (_event, input: unknown) => openDirectory(input))
  ipcMain.handle(IPC_CHANNELS.SETTINGS.CLEAR_LOGS, () => clearLogs())
}
