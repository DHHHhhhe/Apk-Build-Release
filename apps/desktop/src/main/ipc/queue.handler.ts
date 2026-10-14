import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import { cancelQueueItem } from '../services/queue/procedures/cancel'
import { cancelAllQueueItems } from '../services/queue/procedures/cancel-all'
import { clearQueueItems } from '../services/queue/procedures/clear'
import { enqueueProjects } from '../services/queue/procedures/enqueue'
import { listQueueItems } from '../services/queue/procedures/list'
import { retryQueueItem } from '../services/queue/procedures/retry'
import { updateConcurrency } from '../services/queue/procedures/set-concurrency'

export function setupQueueHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.QUEUE.LIST, () => listQueueItems())
  ipcMain.handle(IPC_CHANNELS.QUEUE.ENQUEUE, (_event, input: unknown) => enqueueProjects(input))
  ipcMain.handle(IPC_CHANNELS.QUEUE.SET_CONCURRENCY, (_event, input: unknown) =>
    updateConcurrency(input)
  )
  ipcMain.handle(IPC_CHANNELS.QUEUE.CANCEL, (_event, input: unknown) => cancelQueueItem(input))
  ipcMain.handle(IPC_CHANNELS.QUEUE.CANCEL_ALL, () => cancelAllQueueItems())
  ipcMain.handle(IPC_CHANNELS.QUEUE.RETRY, (_event, input: unknown) => retryQueueItem(input))
  ipcMain.handle(IPC_CHANNELS.QUEUE.CLEAR, (_event, input: unknown) => clearQueueItems(input))
}
