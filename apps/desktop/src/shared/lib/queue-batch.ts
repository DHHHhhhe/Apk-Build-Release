import type { QueueItem } from '@shared/types/queue'

export function isQueueItemActive(item: QueueItem): boolean {
  return item.state === 'pending' || item.state === 'running'
}

/** 主进程任务栏与界面统计共用批次和重试选择，避免历史记录抬高进度。 */
export function currentBatchItems(items: QueueItem[]): { scoped: QueueItem[]; current: QueueItem[] } {
  const active = items.filter(isQueueItemActive)
  let latest: QueueItem | null = null
  for (const item of active.length > 0 ? active : items) {
    if (latest === null || item.enqueuedAt > latest.enqueuedAt) {
      latest = item
    }
  }
  if (latest === null) {
    return { scoped: [], current: [] }
  }
  const batchId = latest.batchId
  const scoped = batchId === null ? active : items.filter((item) => item.batchId === batchId)
  const kept = new Map<string, QueueItem>()
  for (const item of scoped) {
    const previous = kept.get(item.projectId)
    if (
      previous === undefined ||
      item.attempt > previous.attempt ||
      (item.attempt === previous.attempt && item.enqueuedAt > previous.enqueuedAt)
    ) {
      kept.set(item.projectId, item)
    }
  }
  return { scoped, current: Array.from(kept.values()) }
}
