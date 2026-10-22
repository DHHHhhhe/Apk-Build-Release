import { randomUUID } from 'node:crypto'
import { desc, inArray } from 'drizzle-orm'
import { db, sqlite, VARIANT_STATS_KEEP } from '../../../db/client'
import { variantStats } from '../../../db/schema'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('queue:estimate')

/**
 * 参与统计的历史样本上限。
 *
 * 取「最近这么多次」而不是「全部历史」：构建配置、依赖版本、机器负载都会变，
 * 半年前的耗时不该继续压制最近的记录。
 */
export const ESTIMATE_SAMPLE_LIMIT = 10

/**
 * 一次最多扫多少条历史行。
 *
 * 只是兜住极端情况（一个项目跑过几百次），正常规模远到不了这个量；
 * 补上它才不会因为历史越积越多把每次队列推送都拖慢。
 */
const SCAN_ROW_LIMIT = 600

/** 一个变体的历史耗时估值 */
export interface VariantEstimate {
  /** 中位数耗时（毫秒） */
  medianMs: number
  /** 参与统计的样本数 */
  samples: number
}

/** (项目, 变体) 到估值的索引；键用 \u0000 拼接，变体名里不可能出现这个字符 */
export type VariantEstimates = Map<string, VariantEstimate>

export function estimateKey(projectId: string, variant: string): string {
  return projectId + '\u0000' + variant
}

/** 中位数：空输入返回 null；偶数个取中间两个的均值（四舍五入到整数毫秒） */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) {
    return null
  }
  if (sorted.length % 2 === 1) {
    return upper
  }
  const lower = sorted[middle - 1]
  // 两个 undefined 分支都只是为了满足 noUncheckedIndexedAccess 的类型收窄：
  // 长度 ≥ 1 时索引必然有效，运行期走不到这里。
  return lower === undefined ? upper : Math.round((lower + upper) / 2)
}

/**
 * 从一组耗时（**新的在前**）折出估值。
 *
 * 非正数（时钟回拨、同一毫秒内开始并结束）直接丢弃：它们会把中位数拉到接近 0，
 * 进度条就会在一开始就判定「已超出预计」。
 */
export function estimateFromDurations(durations: readonly number[]): VariantEstimate | null {
  const valid: number[] = []
  for (const duration of durations) {
    if (Number.isFinite(duration) && duration > 0) {
      valid.push(duration)
    }
    if (valid.length >= ESTIMATE_SAMPLE_LIMIT) {
      break
    }
  }
  const medianMs = median(valid)
  return medianMs === null ? null : { medianMs, samples: valid.length }
}

/**
 * 查这些项目里每个变体的历史耗时估值。
 *
 * 数据来自 `variant_stats`，**不是** `build_runs`：后者是队列项的子表，用户一「清空队列记录」
 * 就级联删光，预估依据也跟着没了 —— 那样勤清记录的人永远看不到进度条。
 *
 * 只统计**成功**构建：失败与取消的 run 大多提前退出，样本里混进它们会把预估拉低，
 * 进度条就会提前跑满，反而比没有进度条更误导人。
 *
 * 一次 `inArray` 批量取，不在调用方循环里查：队列列表一次要算几十个项目。
 * 查询失败只记一条 warn 并返回空表 —— 少一条进度条不该影响队列本身能不能看。
 */
export function loadVariantEstimates(projectIds: readonly string[]): VariantEstimates {
  const estimates: VariantEstimates = new Map()
  const unique = Array.from(new Set(projectIds)).filter((id) => id !== '')
  if (unique.length === 0) {
    return estimates
  }

  try {
    const rows = db
      .select({
        projectId: variantStats.projectId,
        variant: variantStats.variant,
        durationMs: variantStats.durationMs,
        endedAt: variantStats.endedAt
      })
      .from(variantStats)
      .where(inArray(variantStats.projectId, unique))
      // 新的在前：每个变体分组里直接取前 ESTIMATE_SAMPLE_LIMIT 条就是「最近 N 次」
      .orderBy(desc(variantStats.endedAt))
      .limit(SCAN_ROW_LIMIT)
      .all()

    const durations = new Map<string, number[]>()
    for (const row of rows) {
      // 正数判断要放在「占名额」之前：脏耗时不该算进「最近 10 次」的名额里，
      // 否则它们把有效样本提前挤掉，中位数只剩七八条在算。
      if (row.durationMs <= 0) {
        continue
      }
      const key = estimateKey(row.projectId, row.variant)
      const bucket = durations.get(key)
      if (bucket === undefined) {
        durations.set(key, [row.durationMs])
      } else if (bucket.length < ESTIMATE_SAMPLE_LIMIT) {
        bucket.push(row.durationMs)
      }
    }

    for (const [key, values] of durations) {
      const estimate = estimateFromDurations(values)
      if (estimate !== null) {
        estimates.set(key, estimate)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('读取变体历史耗时失败，本次不显示进度条', { error: message })
    return new Map()
  }

  return estimates
}

/**
 * 记一次成功构建的耗时。
 *
 * 独立的统计表：清空队列记录不会影响它（这正是它存在的理由）。
 * 任何写入错误只记 warn —— 统计失败不该让一个已经成功的构建报错。
 */
export function recordVariantDuration(input: {
  projectId: string
  variant: string
  durationMs: number
  endedAt: Date
  /** 来源构建记录 id：同一次构建重复写入时靠它去重 */
  sourceRunId: string
}): void {
  // 同一毫秒开始并结束、时钟回拨：算不出耗时，记进去只会把中位数拉到接近 0
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    return
  }

  try {
    db.insert(variantStats)
      .values({
        id: randomUUID(),
        projectId: input.projectId,
        variant: input.variant,
        durationMs: Math.round(input.durationMs),
        endedAt: input.endedAt,
        sourceRunId: input.sourceRunId
      })
      .onConflictDoNothing()
      .run()
    pruneOlderSamples(input.projectId, input.variant)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('记录变体耗时失败', { variant: input.variant, error: message })
  }
}

/** 只裁这一个变体的旧样本：每次构建都做全表裁剪太贵，而新样本必然落在它自己的分组里 */
function pruneOlderSamples(projectId: string, variant: string): void {
  sqlite
    .prepare(
      `DELETE FROM variant_stats
        WHERE project_id = ? AND variant = ?
          AND id NOT IN (
            SELECT id FROM variant_stats
             WHERE project_id = ? AND variant = ?
             ORDER BY ended_at DESC
             LIMIT ?
          )`
    )
    .run(projectId, variant, projectId, variant, VARIANT_STATS_KEEP)
}
