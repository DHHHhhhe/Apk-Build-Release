import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../../db/client'
import { projects } from '../../../db/schema'
import type { ProjectListResult } from '../types'
import { listProjects } from './list'

export const reorderInputSchema = z.object({
  /** 期望的新顺序，必须覆盖当前全部项目 —— 免得漏传一项就把顺序写乱 */
  projectIds: z.array(z.string().min(1)).min(1, '至少要有一个项目')
})

export type ReorderInput = z.infer<typeof reorderInputSchema>

/**
 * 手工排序。
 *
 * 一次把**所有**项目的排序位重写成 0..n-1：只写变动的那几项会让新旧编号混在一起，
 * 时间一长就判断不出谁在谁前面。没动的项也照写，代价只是一次事务里的几条 UPDATE。
 */
export function reorderProjects(input: unknown): ProjectListResult {
  const parsed = reorderInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? '顺序不合法', projects: [] }
  }

  const existingIds = new Set(db.select({ id: projects.id }).from(projects).all().map((row) => row.id))
  const given = parsed.data.projectIds

  if (given.length !== existingIds.size || new Set(given).size !== given.length) {
    return { success: false, error: '顺序与当前项目列表对不上，请刷新后重试', projects: [] }
  }
  for (const id of given) {
    if (!existingIds.has(id)) {
      return { success: false, error: '顺序里出现了不存在的项目，请刷新后重试', projects: [] }
    }
  }

  db.transaction((tx) => {
    given.forEach((id, index) => {
      tx.update(projects).set({ sortOrder: index }).where(eq(projects.id, id)).run()
    })
  })

  return listProjects()
}