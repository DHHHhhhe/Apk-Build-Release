import { randomUUID } from 'node:crypto'
import { logger as baseLogger } from '../../logger'
import { QUEUE_CONCURRENCY } from '@shared/constants/queue'
import { getSettingNumber, setSettingNumber } from '../../build/lib/settings'
import type { QueueItem, QueueItemState } from '@shared/types/queue'
import { requestCancel } from './cancel'
import { executeQueueItem } from './executor'
import {
  clearItems,
  countPending,
  createItem,
  findItemRow,
  isFinished,
  listItems,
  listPendingItems,
  listRunningItems,
  parseVariants,
  recoverStaleItems,
  toQueueItemDto,
  updateItem
} from './items'
import { broadcastItem } from './executor'
import { syncTaskbarProgress } from './progress'

const logger = baseLogger.scope('queue:scheduler')

export const CONCURRENCY_KEY = 'queue.concurrency'
export const DEFAULT_CONCURRENCY = QUEUE_CONCURRENCY.DEFAULT
export const MAX_CONCURRENCY = QUEUE_CONCURRENCY.MAX

type Executor = (itemId: string) => Promise<QueueItemState>

let executor: Executor = executeQueueItem
let ticking = false
const running = new Set<string>()
const idleWaiters: Array<() => void> = []

/**
 * 队列是否处于暂停态。
 *
 * 只在启动时可能为 true：上一次退出留下了没跑的 pending 项。这时不自动开跑，
 * 等用户点「继续上次队列」——一开应用就自己占满 CPU 不是用户要的。
 */
let paused = false

export function pauseQueue(): void {
  paused = true
}

export function isQueuePaused(): boolean {
  return paused
}

/** 「继续上次队列」：恢复调度并立刻跑起来 */
export function resumeQueue(): void {
  if (!paused) {
    return
  }
  paused = false
  logger.info('队列已恢复', { pending: countPending() })
  tick()
}

/** 测试用：替换真正的执行器，避免真的去跑 Gradle */
export function setExecutorForTest(next: Executor | null): void {
  executor = next ?? executeQueueItem
}

export function getConcurrency(): number {
  const value = getSettingNumber(CONCURRENCY_KEY, DEFAULT_CONCURRENCY)
  return clampConcurrency(value)
}

export function setConcurrency(limit: number): number {
  const next = clampConcurrency(limit)
  setSettingNumber(CONCURRENCY_KEY, next)
  logger.info('并发上限已调整', { limit: next })
  tick()
  return next
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONCURRENCY
  }
  return Math.min(MAX_CONCURRENCY, Math.max(QUEUE_CONCURRENCY.MIN, Math.round(value)))
}

export function enqueueItem(
  projectId: string,
  variants: string[],
  batchId: string | null = null
): QueueItem {
  const row = createItem(projectId, variants, 1, batchId)
  logger.info('队列项入队', { itemId: row.id, projectId, variants: variants.join(',') })
  broadcastItem(row.id)
  syncTaskbarProgress()
  queueMicrotask(() => {
    tick()
  })
  return toQueueItemDto(row)
}

/** 有空位就取 pending 项来跑；一条项内部的多个变体是顺序执行的 */
export function tick(): void {
  if (ticking || paused) {
    return
  }
  ticking = true
  try {
    let available = getConcurrency() - running.size
    if (available <= 0) {
      return
    }

    for (const row of listPendingItems()) {
      if (available <= 0) {
        break
      }
      running.add(row.id)
      available -= 1
      void executor(row.id)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : '未知错误'
          logger.error('执行队列项抛出异常', { itemId: row.id, error: message })
          updateItem(row.id, { state: 'failed', note: `执行出错：${message}`, finishedAt: new Date() })
          broadcastItem(row.id)
        })
        .finally(() => {
          running.delete(row.id)
          maybeResolveIdle()
          tick()
        })
    }
  } finally {
    ticking = false
    syncTaskbarProgress()
  }
}

export function cancelItem(itemId: string): { success: boolean; error?: string } {
  const row = findItemRow(itemId)
  if (!row) {
    return { success: false, error: '找不到这个队列项' }
  }
  if (row.state === 'running') {
    const requested = requestCancel(itemId)
    if (!requested) {
      return { success: false, error: '这一项已经不在执行中' }
    }
    logger.info('已请求取消', { itemId })
    return { success: true }
  }
  if (row.state === 'pending') {
    updateItem(itemId, { state: 'canceled', note: '入队后取消', finishedAt: new Date() })
    broadcastItem(itemId)
    return { success: true }
  }
  return { success: false, error: '这一项已经结束了，不用取消' }
}

/** 全部取消：正在跑的发取消请求，还在排队的直接置取消 */
export function cancelAllItems(): number {
  let canceled = 0
  for (const row of [...listRunningItems(), ...listPendingItems()]) {
    if (cancelItem(row.id).success) {
      canceled += 1
    }
  }
  if (canceled > 0) {
    logger.info('已请求取消全部队列项', { canceled })
  }
  return canceled
}

/**
 * 重试一条队列项。
 *
 * `onlyVariants` 给出时只重跑这些变体：一个项目有 8 个渠道、挂掉 1 个时，
 * 整项重跑等于把另外 7 个也白打一遍。不传就是整项重跑（老行为）。
 *
 * 批次沿用原项：重试是同一批的补跑，汇总里的「最近一批」应当把这一批看全，
 * 而不是只剩刚补的那一个变体。原项没有批次（老数据）时才新开一个。
 */
export function retryItem(
  itemId: string,
  onlyVariants?: string[]
): { success: boolean; error?: string; item?: QueueItem } {
  const row = findItemRow(itemId)
  if (!row) {
    return { success: false, error: '找不到这个队列项' }
  }
  if (!isFinished(row.state)) {
    return { success: false, error: '这一项还在队列里，等它跑完再重试' }
  }

  const recorded = parseVariants(row.variants)
  const variants =
    onlyVariants && onlyVariants.length > 0
      ? recorded.filter((name) => onlyVariants.includes(name))
      : recorded
  if (variants.length === 0) {
    return {
      success: false,
      error:
        onlyVariants && onlyVariants.length > 0
          ? '要重跑的变体不在这一项里，可能变体已经改名或删除'
          : '这一项没有记录变体，重新入队时请先选变体'
    }
  }

  const created = createItem(row.projectId, variants, row.attempt + 1, row.batchId ?? randomUUID())
  broadcastItem(created.id)
  queueMicrotask(() => {
    tick()
  })
  logger.info('重试队列项', {
    itemId: created.id,
    from: itemId,
    attempt: created.attempt,
    variants: variants.join(',')
  })
  return { success: true, item: toQueueItemDto(created) }
}

export function clearQueue(scope: 'finished' | 'all'): number {
  const removed = clearItems(scope)
  logger.info('清空队列', { scope, removed })
  syncTaskbarProgress()
  return removed
}

export function recoverStale(): number {
  return recoverStaleItems()
}

export function listQueue(limit = 50): QueueItem[] {
  return listItems(limit)
}

export function runningItemIds(): string[] {
  return Array.from(running)
}

/** 测试与退出流程用：等队列彻底空下来 */
export function waitForIdle(timeoutMs = 60_000): Promise<void> {
  if (running.size === 0 && listPendingItems().length === 0) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      resolve()
    }, timeoutMs)
    idleWaiters.push(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function maybeResolveIdle(): void {
  if (running.size === 0 && listPendingItems().length === 0) {
    const waiters = idleWaiters.splice(0)
    for (const waiter of waiters) {
      waiter()
    }
  }
}
