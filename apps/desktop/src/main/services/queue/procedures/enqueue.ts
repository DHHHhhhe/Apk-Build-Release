import { randomUUID } from 'node:crypto'
import { logger as baseLogger } from '../../logger'
import { NO_BUILDABLE_VARIANT_REASON, resolveBuildableVariants } from '@shared/lib/variants'
import { findProjectRow, listVariants } from '../../project/lib/mapper'
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

/** 入队：用界面传进来的变体列表；没勾变体、已在队列里的项目会被跳过并说明原因 */
export function enqueueProjects(input: unknown): QueueMutationResult {
  const parsed = enqueueInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  const created: QueueItem[] = []
  const skipped: string[] = []
  // 这一次调用建的所有队列项共用一个批次：汇总的「最近一批」要覆盖这次入队的全部项目，
  // 而不是只看到最后跑完的那一个
  const batchId = randomUUID()

  for (const target of parsed.data.targets) {
    const project = findProjectRow(target.projectId)
    if (!project) {
      skipped.push(`${target.projectId}：项目不存在`)
      continue
    }

    if (hasActiveItem(project.id)) {
      skipped.push(`${project.name}：已经在队列里`)
      continue
    }

    // 变体由界面显式给出（所见即所建）。这里仍按项目里的真实变体再筛一遍：
    // 界面可能停在旧数据上，而「出包只带 release」这条规则必须由主进程自己保证。
    const variants = listVariants(project.id)
    const { buildable } = resolveBuildableVariants({ variants, selected: target.variants })
    if (target.variants.length === 0) {
      skipped.push(`${project.name}：没有勾选变体`)
      continue
    }
    if (buildable.length === 0) {
      // 勾了却出不了包：只勾了非 release 变体，或勾的变体已从项目里消失
      skipped.push(`${project.name}：${NO_BUILDABLE_VARIANT_REASON}`)
      continue
    }

    created.push(enqueueItem(project.id, buildable, batchId))
    logger.info('项目已入队', { projectId: project.id, variants: buildable.join(','), batchId })
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
