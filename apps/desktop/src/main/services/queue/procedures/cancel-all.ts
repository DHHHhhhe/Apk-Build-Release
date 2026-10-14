import { logger as baseLogger } from '../../logger'
import type { QueueMutationResult } from '../types'
import { cancelAllItems, listQueue } from '../lib/scheduler'

const logger = baseLogger.scope('queue:cancelAll')

export function cancelAllQueueItems(): QueueMutationResult {
  try {
    const canceled = cancelAllItems()
    logger.info('全部取消已受理', { canceled })
    return { success: true, items: listQueue(50) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('全部取消失败', { error: message })
    return { success: false, error: '全部取消失败', items: [] }
  }
}
