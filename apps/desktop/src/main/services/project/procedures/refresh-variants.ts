import { existsSync } from 'node:fs'
import { logger as baseLogger } from '../../logger'
import { refreshVariantsInputSchema } from '../types'
import type { ProjectResult } from '../types'
import { findProjectRow, toProjectDto } from '../lib/mapper'
import { persistVariants } from '../lib/persist'
import { resolveVariants, withFailureHint } from '../lib/resolve-variants'

const logger = baseLogger.scope('project:refreshVariants')

/** 重新解析变体；force=true 时跳过静态解析直接跑 Gradle */
export async function refreshProjectVariants(input: unknown): Promise<ProjectResult> {
  const parsed = refreshVariantsInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), project: null }
  }

  const row = findProjectRow(parsed.data.projectId)
  if (!row) {
    return { success: false, error: '找不到这个项目', project: null }
  }
  if (!existsSync(row.path)) {
    return { success: false, error: '项目目录已经不在了，请重新添加', project: toProjectDto(row) }
  }

  try {
    const outcome = await resolveVariants({
      projectPath: row.path,
      forceGradle: parsed.data.force === true
    })
    persistVariants(row.id, withFailureHint(outcome))

    const updated = findProjectRow(row.id)
    logger.info('变体已刷新', {
      projectId: row.id,
      source: outcome.source,
      variants: outcome.variants.length,
      force: parsed.data.force === true
    })
    return { success: true, project: updated ? toProjectDto(updated) : null }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('刷新变体失败', { error: message })
    return { success: false, error: '刷新变体失败', project: toProjectDto(row) }
  }
}
