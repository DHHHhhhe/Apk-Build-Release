import { logger as baseLogger } from '../../logger'
import { NO_BUILDABLE_VARIANT_REASON, resolveBuildableVariants } from '@shared/lib/variants'
import { findProjectRow, listVariants, parseJsonArray } from '../../project/lib/mapper'
import { enqueueInputSchema } from '../types'
import type { QueueItem, QueueMutationResult } from '../types'
import { enqueueItem, listQueue } from '../lib/scheduler'

const logger = baseLogger.scope('queue:enqueue')

/** 同一个项目在队列里已经有未结束的项时不再重复入队，避免跑两遍 */
function hasActiveItem(projectId: string): boolean {
  return listQueue(200).some(
    (item) =>
      item.projectId === projectId && (item.state === 'pending' || item.state === 'running')
  )
}

/** 入队：用项目当前勾选的变体；没勾变体、已在队列里的项目会被跳过并说明原因 */
export function enqueueProjects(input: unknown): QueueMutationResult {
  const parsed = enqueueInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  const created: QueueItem[] = []
  const skipped: string[] = []

  for (const projectId of parsed.data.projectIds) {
    const project = findProjectRow(projectId)
    if (!project) {
      skipped.push(`${projectId}：项目不存在`)
      continue
    }

    if (hasActiveItem(project.id)) {
      skipped.push(`${project.name}：已经在队列里`)
      continue
    }

    const variants = listVariants(project.id)
    const selected = parseJsonArray(project.selectedVariants)
    // 出包只带 release：界面按同一条规则决定列表显示什么，两边共用这一份实现
    const { buildable } = resolveBuildableVariants({ variants, selected })
    if (selected.length === 0) {
      skipped.push(`${project.name}：没有勾选变体`)
      continue
    }
    if (buildable.length === 0) {
      // 勾了却出不了包：只勾了非 release 变体（旧版本的勾选），或勾的变体已从项目里消失
      skipped.push(`${project.name}：${NO_BUILDABLE_VARIANT_REASON}`)
      continue
    }

    created.push(enqueueItem(project.id, buildable))
    logger.info('项目已入队', { projectId: project.id, variants: buildable.join(',') })
  }

  if (created.length === 0) {
    return {
      success: false,
      error: skipped.length > 0 ? `没有可入队的项目：${skipped.join('；')}` : '没有可入队的项目',
      items: []
    }
  }

  return {
    success: true,
    error: skipped.length > 0 ? `以下项目被跳过：${skipped.join('；')}` : undefined,
    items: created
  }
}
