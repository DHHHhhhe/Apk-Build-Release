import type { QueueItem } from '@shared/types/queue'
import { currentBatchItems, isQueueItemActive } from '@shared/lib/queue-batch'

/** 队列顶部那条进度条要的几个数 */
export interface BatchProgress {
  /** 本批变体总数（分母）：整批跑完前不减少 */
  total: number
  /** 本批已结束的变体数（分子）：成功、失败、取消都算结束 */
  done: number
  /** 本批正在跑的变体数 */
  running: number
  /** 这一批第一项入队的时刻；划不出批次时为 null */
  since: number | null
  /** 这一批最后一项结束的时刻；还有项没跑完时为 null（界面用 now 兜底） */
  until: number | null
}

const NOTHING: BatchProgress = { total: 0, done: 0, running: 0, since: null, until: null }

/**
 * 算「这一批」的变体进度与起止时间。
 *
 * 分母以前只统计还没结束的项，于是每跑完一项整项就退出统计：分母跟着减 1、
 * 分子永远是 0，看起来像卡死（8 个项目各 1 个变体时全程显示 0/N）。
 * 现在按 batchId 圈定整批，跑完的项仍留在分母里。
 *
 * 整批收工后仍然返回这一批的起止 —— 「本批用时」要在跑完之后继续显示，
 * 那才是最想看这个数字的时候。进度条本身收工即隐藏，那由调用方按「有没有
 * 排队/构建中的项」判断，不靠这里归零。
 */
export function computeBatchProgress(items: QueueItem[]): BatchProgress {
  const { scoped, current } = currentBatchItems(items)
  if (scoped.length === 0) {
    return { ...NOTHING }
  }

  const total = current.reduce((sum, item) => sum + item.variants.length, 0)
  const done = current.reduce(
    (sum, item) => sum + item.runs.filter((run) => run.state !== 'running').length,
    0
  )
  const running = current.reduce(
    (sum, item) => sum + item.runs.filter((run) => run.state === 'running').length,
    0
  )

  // 起止按「去重前的整批」算：重试之前那次尝试也在这一批的时间里
  let since = Number.POSITIVE_INFINITY
  let until: number | null = null
  for (const item of scoped) {
    if (item.enqueuedAt < since) {
      since = item.enqueuedAt
    }
    if (item.finishedAt !== null && (until === null || item.finishedAt > until)) {
      until = item.finishedAt
    }
  }

  return {
    total,
    // 防御：变体列表与 run 列表由不同时机写入，取小值免得出现 9/8 这种读数
    done: Math.min(done, total),
    running,
    since: Number.isFinite(since) ? since : null,
    // 还有项没结束就不封口：界面用 now 兜底，数字跟着心跳走
    until: scoped.some(isQueueItemActive) ? null : until
  }
}
