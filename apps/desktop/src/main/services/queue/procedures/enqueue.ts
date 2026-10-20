import { randomUUID } from 'node:crypto'
import { logger as baseLogger } from '../../logger'
import { NO_BUILDABLE_VARIANT_REASON, resolveBuildableVariants } from '@shared/lib/variants'
import type { QueueItemRow } from '../../../db/schema'
import { findProjectRow, listVariants } from '../../project/lib/mapper'
import { enqueueInputSchema } from '../types'
import type { QueueItem, QueueMutationResult } from '../types'
import { listPendingItems, listRunningItems, parseVariants } from '../lib/items'
import { enqueueItem } from '../lib/scheduler'

const logger = baseLogger.scope('queue:enqueue')

/** 还没结束的队列项：它们占着某些变体，也决定了这次要不要沿用同一批次 */
function activeRows(): QueueItemRow[] {
  return [...listRunningItems(), ...listPendingItems()]
}

/**
 * 这些变体已经在队列里了。
 *
 * 判据是「所属队列项还没结束」，而不是「这个变体已经跑完」—— 一条项里前面的变体跑完了、
 * 后面的还在跑时，这一项仍然占着它的全部变体，此时再入一次就是重复构建同一份。
 */
function occupiedVariantsOf(projectId: string, rows: QueueItemRow[]): Set<string> {
  const occupied = new Set<string>()
  for (const row of rows) {
    if (row.projectId !== projectId) {
      continue
    }
    for (const name of parseVariants(row.variants)) {
      occupied.add(name)
    }
  }
  return occupied
}

/**
 * 追加时沿用正在进行的批次。
 *
 * 队列里还有没跑完的项时，新勾的变体是「这一批的补充」，不是新的一批：
 * 汇总里的「最近一批」要能同时看到先跑的和刚追加的，否则前一批会被挤掉。
 * 只有队列空下来（或老数据没有 batch_id）时才新开一批。
 */
function activeBatchId(rows: QueueItemRow[]): string | null {
  const withBatch = rows.filter((row) => row.batchId !== null)
  if (withBatch.length === 0) {
    return null
  }
  const sorted = [...withBatch].sort(
    (left, right) => right.enqueuedAt.getTime() - left.enqueuedAt.getTime()
  )
  return sorted[0]?.batchId ?? null
}

/**
 * 入队：用界面传进来的变体列表。
 *
 * 同一个项目可以再入队，但**只在变体不重复时**：已经在队列里的变体剔掉，
 * 剩下的追加到当前批次。以前是整个项目跳过（「已经在队列里」），
 * 于是项目跑着一个变体时，勾另一个变体按下去毫无反应。
 */
export function enqueueProjects(input: unknown): QueueMutationResult {
  const parsed = enqueueInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), items: [] }
  }

  const created: QueueItem[] = []
  const skipped: string[] = []
  const active = activeRows()
  // 队列里还有没跑完的项时沿用它的批次，否则新开一批
  const batchId = activeBatchId(active) ?? randomUUID()

  for (const target of parsed.data.targets) {
    const project = findProjectRow(target.projectId)
    if (!project) {
      skipped.push(`${target.projectId}：项目不存在`)
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

    const occupied = occupiedVariantsOf(project.id, active)
    const fresh = buildable.filter((name) => !occupied.has(name))
    if (fresh.length === 0) {
      skipped.push(`${project.name}：勾选的变体已经在队列里`)
      continue
    }

    created.push(enqueueItem(project.id, fresh, batchId))
    logger.info('项目已入队', {
      projectId: project.id,
      variants: fresh.join(','),
      skipped: buildable.length - fresh.length,
      batchId
    })
  }

  if (created.length === 0) {
    return {
      success: false,
      error: skipped.length > 0 ? `没有可入队的变体：${skipped.join('；')}` : '没有可入队的变体',
      items: []
    }
  }

  return {
    success: true,
    error: skipped.length > 0 ? `以下内容被跳过：${skipped.join('；')}` : undefined,
    items: created
  }
}
