import { eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'
import { projectIdInputSchema } from '../types'
import type { BasicResult } from '../types'

const logger = baseLogger.scope('project:remove')

/** 删除项目只删登记与变体缓存，不动用户项目目录里的任何文件 */
export function removeProject(input: unknown): BasicResult {
  const parsed = projectIdInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，') }
  }

  try {
    const result = db.delete(projects).where(eq(projects.id, parsed.data.projectId)).run()
    if (result.changes === 0) {
      return { success: false, error: '这个项目已经不在列表里了' }
    }
    logger.info('项目已移除', { projectId: parsed.data.projectId })
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('移除项目失败', { error: message })
    return { success: false, error: '移除项目失败' }
  }
}
