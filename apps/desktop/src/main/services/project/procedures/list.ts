import { desc } from 'drizzle-orm'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'
import type { ProjectListResult } from '../types'
import { toProjectDto } from '../lib/mapper'

const logger = baseLogger.scope('project:list')

export function listProjects(): ProjectListResult {
  try {
    const rows = db.select().from(projects).orderBy(desc(projects.createdAt)).all()
    return { success: true, projects: rows.map(toProjectDto) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取项目列表失败', { error: message })
    return { success: false, error: '读取项目列表失败', projects: [] }
  }
}
