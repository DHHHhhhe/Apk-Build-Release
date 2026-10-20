import type { QueueItem } from '@shared/types/queue'

export interface QueueBatchSplit {
  /** 当前这一批：最近入队的那条所在的批次 */
  current: QueueItem[]
  /** 更早的批次：默认折叠，不删数据（构建记录挂在队列项上，删了会连记录一起没） */
  older: QueueItem[]
}

/**
 * 按批次把队列切成「当前」与「更早」。
 *
 * 没有这一刀时，队列面板会一直堆着历史项：跑完一批、再勾下一批，前一批的完成记录
 * 仍然占着半个面板，用户得自己判断哪几条是这次的。切完之后旧批次默认收起，
 * 数据还在（构建记录、日志、产物都还能查），只是不再挤占视线。
 *
 * 判定「当前批次」的规则：
 * 1. 有未结束的项时，优先看它们 —— 正在跑的那一批就是当前批；
 * 2. 都结束了就看最近入队的那条；
 * 3. 取到的批次是 null（老数据没有这个字段）时不分组，全部照旧显示。
 */
export function splitByCurrentBatch(items: QueueItem[]): QueueBatchSplit {
  const active = items.filter((item) => item.state === 'pending' || item.state === 'running')
  const pool = active.length > 0 ? active : items
  const latest = [...pool].sort((left, right) => right.enqueuedAt - left.enqueuedAt)[0]
  const batchId = latest?.batchId ?? null

  if (batchId === null) {
    return { current: items, older: [] }
  }

  return {
    // 未结束的项永远可见：正在跑的那条不能因为「不属于当前批」被收进折叠区
    current: items.filter(
      (item) =>
        item.state === 'pending' || item.state === 'running' || item.batchId === batchId
    ),
    older: items.filter(
      (item) =>
        item.state !== 'pending' && item.state !== 'running' && item.batchId !== batchId
    )
  }
}
