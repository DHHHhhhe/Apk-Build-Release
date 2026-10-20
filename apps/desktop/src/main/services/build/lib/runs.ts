import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { buildRuns, queueItems } from '../../../db/schema'
import type { BuildRunRow, QueueItemRow } from '../../../db/schema'
import type { BuildRun, BuildRunState, BuildStagePoint } from '@shared/types/build'

/** 阶段切换点存在库里是一段 JSON；读不出来就当作没有（老记录全是 NULL） */
function parseStagePoints(raw: string | null): BuildStagePoint[] {
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is BuildStagePoint => {
      if (typeof item !== 'object' || item === null) {
        return false
      }
      const record = item as Partial<BuildStagePoint>
      return typeof record.phase === 'string' && typeof record.at === 'number'
    })
  } catch {
    return []
  }
}

export function toBuildRunDto(row: BuildRunRow, projectId: string): BuildRun {
  return {
    id: row.id,
    projectId,
    variant: row.variant,
    state: row.state,
    exitCode: row.exitCode,
    logPath: row.logPath,
    apkPath: row.apkPath,
    apkName: row.apkName,
    applicationId: row.applicationId,
    versionName: row.versionName,
    versionCode: row.versionCode,
    signed: row.signed,
    failureKind: row.failureKind,
    failureHint: row.failureHint,
    stages: parseStagePoints(row.stagePoints),
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null
  }
}

export function createQueueItem(projectId: string): QueueItemRow {
  const id = randomUUID()
  db.insert(queueItems).values({ id, projectId, state: 'running', startedAt: new Date() }).run()
  const row = db.select().from(queueItems).where(eq(queueItems.id, id)).get()
  if (!row) {
    throw new Error('队列项写入后读不回来')
  }
  return row
}

export function finishQueueItem(queueItemId: string, state: BuildRunState): void {
  db.update(queueItems)
    .set({ state, finishedAt: new Date() })
    .where(eq(queueItems.id, queueItemId))
    .run()
}

export function createBuildRun(queueItemId: string, variant: string): BuildRunRow {
  const id = randomUUID()
  db.insert(buildRuns).values({ id, queueItemId, variant, state: 'running' }).run()
  const row = db.select().from(buildRuns).where(eq(buildRuns.id, id)).get()
  if (!row) {
    throw new Error('构建记录写入后读不回来')
  }
  return row
}

export interface BuildRunPatch {
  state?: BuildRunState
  exitCode?: number | null
  logPath?: string | null
  apkPath?: string | null
  apkName?: string | null
  applicationId?: string | null
  versionName?: string | null
  versionCode?: number | null
  signed?: boolean | null
  failureKind?: BuildRun['failureKind']
  failureHint?: string | null
  /** 阶段切换点的 JSON；构建结束时写一次，供历史记录复用 */
  stagePoints?: string | null
  finishedAt?: Date | null
}

export function getBuildRun(runId: string): BuildRunRow | null {
  const row = db.select().from(buildRuns).where(eq(buildRuns.id, runId)).get()
  return row ?? null
}

export function updateBuildRun(runId: string, patch: BuildRunPatch): BuildRunRow | null {
  // 空 patch 会让 Drizzle 抛 "No values to set"，只读场景走 getBuildRun
  if (Object.keys(patch).length > 0) {
    db.update(buildRuns).set(patch).where(eq(buildRuns.id, runId)).run()
  }
  return getBuildRun(runId)
}

export function listRunsByProject(projectId: string, limit = 20): BuildRun[] {
  const rows = db
    .select({ run: buildRuns })
    .from(buildRuns)
    .innerJoin(queueItems, eq(buildRuns.queueItemId, queueItems.id))
    .where(eq(queueItems.projectId, projectId))
    .orderBy(desc(buildRuns.startedAt))
    .limit(limit)
    .all()

  return rows.map((item) => toBuildRunDto(item.run, projectId))
}
