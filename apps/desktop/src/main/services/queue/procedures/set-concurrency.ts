import { logger as baseLogger } from '../../logger'
import { setConcurrencyInputSchema } from '../types'
import type { QueueMutationResult } from '../types'
import { listQueue, setConcurrency } from '../lib/scheduler'

const logger = baseLogger.scope('queue:setConcurrency')

export function updateConcurrency(input: unknown): QueueMutationResult {
  const parsed = setConcurrencyInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  try {
    setConcurrency(parsed.data.limit)
    return { success: true, items: listQueue(50) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('设置并发上限失败', { error: message })
    return { success: false, error: '设置并发上限失败', items: [] }
  }
}
