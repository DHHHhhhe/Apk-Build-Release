import { logger as baseLogger } from '../../logger'
import { projectPreflightInputSchema } from '../types'
import type { ProjectPreflightResult } from '../types'
import { preflightProjects } from '../lib/preflight'

const logger = baseLogger.scope('project:preflight')

/**
 * 批量预检：勾选表用它标出「一眼看得出缺东西」的项目。
 * 只提示不拦 —— 用户可能就想先把队排上、边修环境边等。
 */
export function preflightProjectList(input: unknown): ProjectPreflightResult {
  const parsed = projectPreflightInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('，'),
      projects: []
    }
  }

  try {
    return { success: true, projects: preflightProjects(parsed.data.projectIds) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('预检失败', { error: message })
    return { success: false, error: '预检失败', projects: [] }
  }
}
