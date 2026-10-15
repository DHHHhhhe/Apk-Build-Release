import { desc } from 'drizzle-orm'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'
import type { ProjectListResult } from '../types'
import { toProjectDto } from '../lib/mapper'

const logger = baseLogger.scope('project:list')

export function listProjects(): ProjectListResult {
  try {
    // 手工排序位优先；都还没排过（全 null）时退化成原来的「新的在前」，
    // 所以这个功能上线前的老数据表现完全不变
    const rows = db
      .select()
      .from(projects)
      .orderBy(projects.sortOrder, desc(projects.createdAt))
      .all()
    return { success: true, projects: rows.map(toProjectDto) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取项目列表失败', { error: message })
    return { success: false, error: '读取项目列表失败', projects: [] }
  }
}
