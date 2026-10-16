import type { QueueItem, QueueItemState } from '../types/queue'

/**
 * 队列列表的排序规则（一句话）：**正在构建 → 排队中（先入队在前）→ 已结束（最近完成的在前）**。
 *
 * 以前没有统一规则，而且三个地方各排各的：
 * 主进程按 `enqueued_at` 倒序（最新的在最前）、客户端事件处理也按倒序、我新加的合并函数又是另一套 ——
 * 于是界面上会出现「构建中 → 已取消 → 排队中」这种说不出道理的顺序。
 * 现在三处都走这一个函数，规则只有这一份。
 */
const STATE_RANK: Record<QueueItemState, number> = {
  running: 0,
  pending: 1,
  // 已结束的三种同属一组：它们都不需要用户等着，只是留个记录
  success: 2,
  failed: 2,
  canceled: 2
}

export function sortQueueItems(items: QueueItem[]): QueueItem[] {
  return [...items].sort((left, right) => {
    const rankDiff = STATE_RANK[left.state] - STATE_RANK[right.state]
    if (rankDiff !== 0) {
      return rankDiff
    }

    if (left.state === 'running') {
      // 同时跑多个时（并发上限 > 1）：先开始的在前
      const leftAt = left.startedAt ?? Number.MAX_SAFE_INTEGER
      const rightAt = right.startedAt ?? Number.MAX_SAFE_INTEGER
      if (leftAt !== rightAt) {
        return leftAt - rightAt
      }
    } else if (left.state === 'pending') {
      // 排队中：先入队的在前（FIFO）—— 与调度器取任务的顺序一致，用户看到的位次才是真的
      if (left.enqueuedAt !== right.enqueuedAt) {
        return left.enqueuedAt - right.enqueuedAt
      }
    } else {
      // 已结束：最近完成的在前
      const leftAt = left.finishedAt ?? left.enqueuedAt
      const rightAt = right.finishedAt ?? right.enqueuedAt
      if (leftAt !== rightAt) {
        return rightAt - leftAt
      }
    }

    // 兜底：保证同一份数据每次排出来都一样，不会因为顺序抖动而让列表跳动
    return left.id.localeCompare(right.id)
  })
}