import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'
import { addProjectInputSchema } from '../types'
import type { ProjectResult } from '../types'
import { persistVariants } from '../lib/persist'
import { resolveVariants, withFailureHint } from '../lib/resolve-variants'
import { toProjectDto, findProjectRow } from '../lib/mapper'

const logger = baseLogger.scope('project:add')

/** 比较用：Windows 大小写不敏感，末尾的分隔符也去掉 */
function normalizeForCompare(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/** 添加本地项目：校验目录 → 解析变体 → 落库 */
export async function addProject(input: unknown): Promise<ProjectResult> {
  const parsed = addProjectInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), project: null }
  }

  const projectPath = resolve(parsed.data.path.trim())
  if (!existsSync(projectPath)) {
    return { success: false, error: '这个路径不存在', project: null }
  }
  if (!statSync(projectPath).isDirectory()) {
    return { success: false, error: '请选择项目目录，而不是文件', project: null }
  }

  // 路径先规范化再比：Windows 上 C:\projects\App 与 c:\projects\app 是同一个目录，
  // 直接拿字符串比会让同一个项目被加进来两次
  const existing = db
    .select()
    .from(projects)
    .all()
    .find((row) => normalizeForCompare(row.path) === normalizeForCompare(projectPath))
  if (existing) {
    return { success: false, error: `这个项目已经添加过了：${existing.name}`, project: toProjectDto(existing) }
  }

  const projectId = randomUUID()
  const name = basename(projectPath)

  try {
    db.insert(projects)
      .values({
        id: projectId,
        name,
        path: projectPath,
        selectedVariants: '[]'
      })
      .run()

    // 添加时只做静态解析（毫秒级），不跑 Gradle 兜底：
    // 静态解析失败的项目如果在这里跑兜底，用户会在「解析中」上干等最长 5 分钟。
    // 需要兜底时由用户点「用 Gradle 解析（较慢）」，走 refresh 那条路径。
    const outcome = await resolveVariants({ projectPath, allowGradleFallback: false })
    persistVariants(projectId, withFailureHint(outcome))

    const row = findProjectRow(projectId)
    if (!row) {
      return { success: false, error: '项目写入后读不回来', project: null }
    }

    logger.info('项目已添加', {
      projectId,
      path: projectPath,
      variants: outcome.variants.length,
      source: outcome.source
    })
    return { success: true, project: toProjectDto(row) }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('添加项目失败', { error: message, path: projectPath })
    return { success: false, error: '添加项目失败', project: null }
  }
}
