import { existsSync, statSync } from 'node:fs'
import { desc, eq } from 'drizzle-orm'
import { db } from '../../../db/client'
import { buildRuns, projects, queueItems } from '../../../db/schema'
import type { BuildSummary, SummaryArtifact, SummaryGroup, SummaryScope } from '@shared/types/build'
import { getOutputRoot } from './settings'

interface SummaryQuery {
  scope: SummaryScope
}

const FINISHED_ITEM_STATES = ['success', 'failed', 'canceled'] as const

/**
 * 结果汇总：一次批量到底出了哪些包、成没成、多大、签没签名。
 * 汇总天然是跨项目的 —— 「这一批出了哪些包」本来就是全局问题，
 * 单个项目的明细在构建记录面板里看。
 * 「最近一批」按队列项取（一个项目 = 一条队列项，一次入队 = 一条）。
 */
export function buildSummary(query: SummaryQuery): BuildSummary {
  const rows = db
    .select({ run: buildRuns, item: queueItems, project: projects })
    .from(buildRuns)
    .innerJoin(queueItems, eq(buildRuns.queueItemId, queueItems.id))
    .innerJoin(projects, eq(queueItems.projectId, projects.id))
    .orderBy(desc(buildRuns.startedAt))
    .all()

  const selected =
    query.scope === 'latest' ? newestBatch(rows) : rows.filter((row) => row.run.finishedAt !== null)

  const groups: SummaryGroup[] = []
  const byProject = new Map<string, SummaryGroup>()
  const totals = {
    projects: 0,
    variants: 0,
    success: 0,
    failed: 0,
    canceled: 0,
    durationMs: 0,
    apkCount: 0,
    apkBytes: 0,
    unsignedCount: 0
  }

  for (const row of selected) {
    let group = byProject.get(row.project.id)
    if (!group) {
      group = {
        projectId: row.project.id,
        projectName: row.project.name,
        projectPath: row.project.path,
        artifacts: []
      }
      byProject.set(row.project.id, group)
      groups.push(group)
    }

    const artifact = toArtifact(row.run)
    group.artifacts.push(artifact)
    totals.variants += 1

    if (artifact.state === 'success') {
      totals.success += 1
    } else if (artifact.state === 'failed') {
      totals.failed += 1
    } else if (artifact.state === 'canceled') {
      totals.canceled += 1
    }

    if (artifact.durationMs !== null) {
      totals.durationMs += artifact.durationMs
    }
    if (artifact.apkPath !== null) {
      totals.apkCount += 1
      totals.apkBytes += artifact.apkBytes
    }
    if (artifact.signed === false) {
      totals.unsignedCount += 1
    }
  }

  totals.projects = groups.length

  return { scope: query.scope, totals, groups, outputRoot: getOutputRoot() }
}

/** 最近一条跑完的队列项里的所有变体 */
function newestBatch<T extends { item: { id: string; state: string } }>(rows: T[]): T[] {
  const latest = rows.find((row) =>
    (FINISHED_ITEM_STATES as readonly string[]).includes(row.item.state)
  )
  if (!latest) {
    return []
  }
  return rows.filter((row) => row.item.id === latest.item.id)
}

function toArtifact(run: typeof buildRuns.$inferSelect): SummaryArtifact {
  const apkBytes = readFileSize(run.apkPath)
  return {
    variant: run.variant,
    state: run.state,
    durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    finishedAt: run.finishedAt ? run.finishedAt.getTime() : null,
    apkName: run.apkName,
    apkPath: run.apkPath,
    apkBytes: apkBytes ?? 0,
    // 记录里有路径、磁盘上却没了：产物被清理或挪走了，汇总里要能看出来
    apkMissing: run.apkPath !== null && apkBytes === null,
    signed: run.signed,
    versionName: run.versionName,
    applicationId: run.applicationId,
    failureHint: run.failureHint
  }
}

function readFileSize(path: string | null): number | null {
  if (!path || !existsSync(path)) {
    return null
  }
  try {
    return statSync(path).size
  } catch {
    return null
  }
}
