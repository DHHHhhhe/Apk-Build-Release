import { logger as baseLogger } from '../../logger'
import { clearQueueInputSchema } from '../types'
import type { QueueMutationResult } from '../types'
import { clearQueue, listQueue, tick } from '../lib/scheduler'

const logger = baseLogger.scope('queue:clear')

export function clearQueueItems(input: unknown): QueueMutationResult {
  const parsed = clearQueueInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  try {
    const removed = clearQueue(parsed.data.scope)
    logger.info('已清空队列', { scope: parsed.data.scope, removed })
    tick()
    return { success: true, items: listQueue(50) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('清空队列失败', { error: message })
    return { success: false, error: '清空队列失败', items: [] }
  }
}
