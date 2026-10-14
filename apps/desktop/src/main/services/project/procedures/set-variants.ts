import { logger as baseLogger } from '../../logger'
import { setVariantsInputSchema } from '../types'
import type { ProjectResult } from '../types'
import { findProjectRow, listVariants, toProjectDto } from '../lib/mapper'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { eq } from 'drizzle-orm'

const logger = baseLogger.scope('project:setVariants')

/** 保存用户勾选的变体；不在当前变体列表里的名字会被丢掉并如实回报 */
export function setProjectVariants(input: unknown): ProjectResult {
  const parsed = setVariantsInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), project: null }
  }

  const row = findProjectRow(parsed.data.projectId)
  if (!row) {
    return { success: false, error: '找不到这个项目', project: null }
  }

  const known = new Set(listVariants(row.id).map((variant) => variant.name))
  const accepted = parsed.data.variants.filter((name) => known.has(name))
  const dropped = parsed.data.variants.filter((name) => !known.has(name))

  try {
    db.update(projects)
      .set({ selectedVariants: JSON.stringify(accepted) })
      .where(eq(projects.id, row.id))
      .run()

    if (dropped.length > 0) {
      logger.warn('丢弃了不在变体列表里的选择', { projectId: row.id, dropped: dropped.join(',') })
    }

    const updated = findProjectRow(row.id)
    return {
      success: true,
      project: updated ? toProjectDto(updated) : null,
      error: dropped.length > 0 ? `已忽略无效变体：${dropped.join('、')}` : undefined
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存变体选择失败', { error: message })
    return { success: false, error: '保存变体选择失败', project: null }
  }
}
