import { logger as baseLogger } from '../../logger'
import { projectRunsInputSchema } from '../types'
import type { BuildListResult } from '../types'
import { listRunsByProject } from '../lib/runs'

const logger = baseLogger.scope('build:listRuns')

export function listProjectRuns(input: unknown): BuildListResult {
  const parsed = projectRunsInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), runs: [] }
  }

  try {
    return {
      success: true,
      runs: listRunsByProject(parsed.data.projectId, parsed.data.limit ?? 20)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取构建记录失败', { error: message })
    return { success: false, error: '读取构建记录失败', runs: [] }
  }
}
