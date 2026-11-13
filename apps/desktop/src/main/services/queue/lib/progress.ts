import { BrowserWindow } from 'electron'
import { QUEUE_LIST_LIMIT } from '@shared/constants/queue'
import { currentBatchItems, isQueueItemActive } from '@shared/lib/queue-batch'
import { variantProgressPercent } from '@shared/lib/variant-progress'
import type { QueueItem } from '@shared/types/queue'
import { listItems } from './items'

let snapshot: QueueItem[] = []
let heartbeat: ReturnType<typeof setInterval> | null = null

function stopHeartbeat(): void {
  if (heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

/** 当前批次按变体等权汇总；正在构建的变体使用队列行的同一份耗时估算。 */
function progressValue(items: QueueItem[], now: number): number {
  const { current } = currentBatchItems(items)
  let total = 0
  let completed = 0
  for (const item of current) {
    const runs = new Map(item.runs.map((run) => [run.variant, run]))
    for (const variant of item.variants) {
      total += 1
      const run = runs.get(variant)
      if (!isQueueItemActive(item) || (run && run.state !== 'running')) {
        completed += 1
      } else if (run?.state === 'running') {
        const percent = variantProgressPercent(run, now, true)
        if (percent === null) {
          // Electron 约定大于 1 为不定进度：没有样本时不伪造百分比。
          return 2
        }
        completed += percent / 100
      }
    }
  }
  return total === 0 ? 0 : Math.min(1, completed / total)
}

function renderProgress(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    stopHeartbeat()
    return
  }
  if (!snapshot.some(isQueueItemActive)) {
    win.setProgressBar(-1)
    stopHeartbeat()
    return
  }
  win.setProgressBar(progressValue(snapshot, Date.now()))
  if (heartbeat === null) {
    // 估算随时间变化，即使 Gradle 没有新输出也要刷新；心跳复用快照，不轮询数据库。
    heartbeat = setInterval(renderProgress, 1000)
    heartbeat.unref()
  }
}

/** 状态变更时更新快照，全部结束或清空后立即移除任务栏进度并停止心跳。 */
export function syncTaskbarProgress(): void {
  snapshot = listItems(QUEUE_LIST_LIMIT)
  renderProgress()
}
