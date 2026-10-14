import { logger as baseLogger } from '../../logger'
import { buildSummaryInputSchema } from '../types'
import type { BuildSummaryResult } from '../types'
import { buildSummary } from '../lib/summary'

const logger = baseLogger.scope('build:summary')

export function readBuildSummary(input: unknown): BuildSummaryResult {
  const parsed = buildSummaryInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), summary: null }
  }

  try {
    return { success: true, summary: buildSummary(parsed.data) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取结果汇总失败', { error: message })
    return { success: false, error: '读取结果汇总失败', summary: null }
  }
}
