import { logger as baseLogger } from '../../logger'
import { queueItemInputSchema } from '../types'
import type { QueueMutationResult } from '../types'
import { cancelItem, listQueue } from '../lib/scheduler'

const logger = baseLogger.scope('queue:cancel')

export function cancelQueueItem(input: unknown): QueueMutationResult {
  const parsed = queueItemInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  const result = cancelItem(parsed.data.itemId)
  if (!result.success) {
    return { success: false, error: result.error, items: listQueue(50) }
  }

  logger.info('取消请求已受理', { itemId: parsed.data.itemId })
  return { success: true, items: listQueue(50) }
}
