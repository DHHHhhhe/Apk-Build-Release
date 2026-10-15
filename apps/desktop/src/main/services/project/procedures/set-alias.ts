import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import { findProjectRow, toProjectDto } from '../lib/mapper'
import type { Project } from '../types'

export const setAliasInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  /** null 或空串表示清掉别名，归档时回到用项目名 */
  alias: z.string().max(64, '别名最多 64 个字符').nullable()
})

export type SetAliasInput = z.infer<typeof setAliasInputSchema>

export interface SetAliasResult {
  success: boolean
  error?: string
  project?: Project
}

/**
 * 设置项目别名。
 *
 * 别名只影响「产物归档到统一输出目录时的文件夹名」，不参与构建本身 ——
 * 所以这里不做多余的校验，改错了随时能改回来。路径安全在归档那一侧挡（见 artifacts.ts）。
 */
export function setProjectAlias(input: unknown): SetAliasResult {
  const parsed = setAliasInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? '别名不合法' }
  }

  const { projectId, alias } = parsed.data
  if (!findProjectRow(projectId)) {
    return { success: false, error: '项目已经被移除了' }
  }

  const trimmed = alias?.trim() ?? ''
  db.update(projects)
    .set({ alias: trimmed.length === 0 ? null : trimmed })
    .where(eq(projects.id, projectId))
    .run()

  const updated = findProjectRow(projectId)
  if (!updated) {
    return { success: false, error: '更新后读不回项目' }
  }
  return { success: true, project: toProjectDto(updated) }
}