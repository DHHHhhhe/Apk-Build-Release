import type { QueueRunDetail } from '@shared/types/queue'

/** 刚开始那一两秒也要有可见的一小段，否则进度条看起来像没画出来 */
const MIN_PERCENT = 2

/**
 * 变体进度条的百分比。
 *
 * 分子是已用时间，分母是该变体历史**成功**构建耗时的中位数 —— 这是耗时比例，
 * 不是 Gradle 的任务进度，所以到达 100% 也不代表下一毫秒就结束。
 *
 * 返回 null 表示「不该画进度条」：开关关掉、这个变体还没开跑、或者没有历史样本。
 * 用 null 而不是 0，是因为这两件事在界面上必须区分 —— 0% 的空条会让人以为在跑但没进展。
 */
export function variantProgressPercent(
  run: QueueRunDetail,
  now: number,
  enabled: boolean
): number | null {
  if (!enabled || run.state !== 'running' || run.startedAt === null) {
    return null
  }
  const estimate = run.estimatedMs
  if (estimate === null || estimate <= 0) {
    return null
  }
  const elapsed = Math.max(0, now - run.startedAt)
  // 超出预估就停在 100%：继续加会越过容器，回退更会让人以为进度倒退
  return Math.min(100, Math.max(MIN_PERCENT, Math.round((elapsed / estimate) * 100)))
}
