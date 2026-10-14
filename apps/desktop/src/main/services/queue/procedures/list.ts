import { logger as baseLogger } from '../../logger'
import { QUEUE_LIST_LIMIT } from '@shared/constants/queue'
import type { QueueListResult } from '../types'
import { getConcurrency, listQueue } from '../lib/scheduler'

const logger = baseLogger.scope('queue:list')

export function listQueueItems(): QueueListResult {
  try {
    return { success: true, concurrency: getConcurrency(), items: listQueue(QUEUE_LIST_LIMIT) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取队列失败', { error: message })
    return { success: false, error: '读取队列失败', concurrency: 1, items: [] }
  }
}
