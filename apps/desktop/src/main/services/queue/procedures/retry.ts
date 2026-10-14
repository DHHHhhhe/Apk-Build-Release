import { logger as baseLogger } from '../../logger'
import { queueItemInputSchema } from '../types'
import type { QueueMutationResult } from '../types'
import { listQueue, retryItem } from '../lib/scheduler'

const logger = baseLogger.scope('queue:retry')

/** 重试会新建一条队列项（attempt + 1），保留原来的记录便于对比 */
export function retryQueueItem(input: unknown): QueueMutationResult {
  const parsed = queueItemInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  const result = retryItem(parsed.data.itemId)
  if (!result.success) {
    return { success: false, error: result.error, items: listQueue(50) }
  }

  logger.info('重试已入队', { itemId: result.item?.id, attempt: result.item?.attempt })
  return { success: true, items: listQueue(50) }
}
