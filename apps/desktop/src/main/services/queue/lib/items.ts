import { randomUUID } from 'node:crypto'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../../db/client'
import { buildRuns, projects, queueItems } from '../../../db/schema'
import type { QueueItemRow } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'
import type { QueueItem, QueueItemState, QueueRunDetail } from '@shared/types/queue'
import { sortRunsByDeclaredOrder } from './run-order'

const logger = baseLogger.scope('queue:items')

export function parseVariants(raw: string | null): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
    return []
  } catch {
    return []
  }
}

export function createItem(
  projectId: string,
  variants: string[],
  attempt = 1,
  batchId: string | null = null
): QueueItemRow {
  const id = randomUUID()
  db.insert(queueItems)
    .values({
      id,
      projectId,
      state: 'pending',
      variants: JSON.stringify(variants),
      batchId,
      attempt
    })
    .run()
  const row = findItemRow(id)
  if (!row) {
    throw new Error('队列项写入后读不回来')
  }
  return row
}

export function findItemRow(itemId: string): QueueItemRow | null {
  const row = db.select().from(queueItems).where(eq(queueItems.id, itemId)).get()
  return row ?? null
}

export function updateItem(
  itemId: string,
  patch: Partial<Pick<QueueItemRow, 'state' | 'note' | 'startedAt' | 'finishedAt'>>
): QueueItemRow | null {
  if (Object.keys(patch).length > 0) {
    db.update(queueItems).set(patch).where(eq(queueItems.id, itemId)).run()
  }
  return findItemRow(itemId)
}

export function listPendingItems(): QueueItemRow[] {
  return db
    .select()
    .from(queueItems)
    .where(eq(queueItems.state, 'pending'))
    .orderBy(queueItems.enqueuedAt)
    .all()
}

export function listRunningItems(): QueueItemRow[] {
  return db.select().from(queueItems).where(eq(queueItems.state, 'running')).all()
}

export function countRunning(): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(queueItems)
    .where(eq(queueItems.state, 'running'))
    .get()
  return row?.value ?? 0
}

export function countPending(): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(queueItems)
    .where(eq(queueItems.state, 'pending'))
    .get()
  return row?.value ?? 0
}

export function toQueueItemDto(row: QueueItemRow): QueueItem {
  const project = db.select().from(projects).where(eq(projects.id, row.projectId)).get()
  // 变体顺序按入队时记下的勾选顺序排：只按 started_at 排的话，同一毫秒建的 run 顺序不定，
  // 每次推送快照列表里都可能换一次位（用户看到的「顺序跳动」）
  const variants = parseVariants(row.variants)
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: project?.name ?? '（项目已移除）',
    projectPath: project?.path ?? '',
    state: row.state,
    variants,
    attempt: row.attempt,
    enqueuedAt: row.enqueuedAt.getTime(),
    startedAt: row.startedAt ? row.startedAt.getTime() : null,
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
    note: row.note,
    runs: sortRunsByDeclaredOrder(listRunsForItem(row.id), variants)
  }
}

/** 一条队列项下每个变体的构建记录与耗时，按开始时间排序 */
export function listRunsForItem(itemId: string): QueueRunDetail[] {
  const rows = db
    .select()
    .from(buildRuns)
    .where(eq(buildRuns.queueItemId, itemId))
    .orderBy(buildRuns.startedAt)
    .all()

  return rows.map((row) => ({
    variant: row.variant,
    state: row.state,
    startedAt: row.startedAt.getTime(),
    // 跑完才有耗时；跑着的界面用 startedAt 自己算，避免这里给出一个会过期的数
    durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
    failureKind: row.failureKind,
    failureHint: row.failureHint,
    apkName: row.apkName,
    apkPath: row.apkPath,
    logPath: row.logPath
  }))
}

export function listItems(limit = 50): QueueItem[] {
  const rows = db.select().from(queueItems).orderBy(desc(queueItems.enqueuedAt)).limit(limit).all()
  return rows.map(toQueueItemDto)
}

export function clearItems(scope: 'finished' | 'all'): number {
  if (scope === 'all') {
    const result = db.delete(queueItems).run()
    return result.changes
  }
  const result = db
    .delete(queueItems)
    .where(inArray(queueItems.state, ['success', 'failed', 'canceled']))
    .run()
  return result.changes
}

/**
 * 启动时收尾：上一次进程被强杀时留下的 **running** 项不可能再有人管，
 * 标成 failed 并写明原因，而不是让界面一直转圈。
 *
 * `pending` 有意保留：它是「排上队但还没轮到」的项，重启后仍然可以跑。
 * 是否续跑交给用户决定（启动时队列处于暂停态，界面给一个「继续上次队列」按钮），
 * 免得一开应用就自己占满 CPU。这条以前把 pending 也一并标失败，等于把用户的排队白排了。
 */
export function recoverStaleItems(): number {
  const stale = db.select().from(queueItems).where(eq(queueItems.state, 'running')).all()

  if (stale.length === 0) {
    return 0
  }

  db.update(queueItems)
    .set({ state: 'failed', note: '工具上次异常退出，这次构建没有完成', finishedAt: new Date() })
    .where(eq(queueItems.state, 'running'))
    .run()

  db.update(buildRuns)
    .set({ state: 'failed', failureHint: '工具上次异常退出', finishedAt: new Date() })
    .where(eq(buildRuns.state, 'running'))
    .run()

  logger.warn('收尾了残留的队列项', { count: stale.length })
  return stale.length
}

export function isFinished(state: QueueItemState): boolean {
  return state === 'success' || state === 'failed' || state === 'canceled'
}
