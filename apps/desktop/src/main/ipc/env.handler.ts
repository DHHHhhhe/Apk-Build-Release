import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { probeEnvironment } from '../services/env/procedures/probe'

/** IPC handler 只做转发，业务逻辑在 services 里（api-module.md） */
export function setupEnvHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ENV.PROBE, (_event, input: unknown) => probeEnvironment(input))
}
