import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '../../../db/client'
import { buildRuns, queueItems } from '../../../db/schema'
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
 * 只统计**成功**的构建：失败与取消的 run 大多提前退出，样本里混进它们会把预估拉低，
 * 进度条就会提前跑满，反而比没有进度条更误导人。
 *
 * 一次 `innerJoin` 批量取，不在调用方循环里查：队列列表一次要算几十个项目。
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
        projectId: queueItems.projectId,
        variant: buildRuns.variant,
        startedAt: buildRuns.startedAt,
        finishedAt: buildRuns.finishedAt
      })
      .from(buildRuns)
      .innerJoin(queueItems, eq(buildRuns.queueItemId, queueItems.id))
      .where(
        and(
          inArray(queueItems.projectId, unique),
          eq(buildRuns.state, 'success'),
          isNotNull(buildRuns.finishedAt)
        )
      )
      // 新的在前：每个变体分组里直接取前 ESTIMATE_SAMPLE_LIMIT 条就是「最近 N 次」
      .orderBy(desc(buildRuns.finishedAt))
      .limit(SCAN_ROW_LIMIT)
      .all()

    const durations = new Map<string, number[]>()
    for (const row of rows) {
      if (row.finishedAt === null) {
        continue
      }
      // 正数判断要放在「占名额」之前：脏耗时（时钟回拨、同一毫秒开始并结束）不该算进
      // 「最近 10 次」的名额里，否则它们把有效样本提前挤掉，中位数只剩七八条在算。
      const duration = row.finishedAt.getTime() - row.startedAt.getTime()
      if (duration <= 0) {
        continue
      }
      const key = estimateKey(row.projectId, row.variant)
      const bucket = durations.get(key)
      if (bucket === undefined) {
        durations.set(key, [duration])
      } else if (bucket.length < ESTIMATE_SAMPLE_LIMIT) {
        bucket.push(duration)
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
