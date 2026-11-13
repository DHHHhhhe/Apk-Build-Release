import type { QueueRunDetail } from '@shared/types/queue'

/** 刚开始也保留一小段可见进度，与队列行保持一致。 */
const MIN_PERCENT = 2

/** 按已用时间与历史成功耗时估算；没有估值、未开始或关闭显示时返回 null。 */
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
  // 这是耗时比例，超出预计后保持 100%，实际结束以构建状态为准。
  return Math.min(100, Math.max(MIN_PERCENT, Math.round((elapsed / estimate) * 100)))
}
