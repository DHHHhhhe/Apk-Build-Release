import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { listProjectRuns } from '../services/build/procedures/list-runs'
import { readBuildSummary } from '../services/build/procedures/summary'

export function setupBuildHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BUILD.LIST_RUNS, (_event, input: unknown) => listProjectRuns(input))
  ipcMain.handle(IPC_CHANNELS.BUILD.SUMMARY, (_event, input: unknown) => readBuildSummary(input))
}
