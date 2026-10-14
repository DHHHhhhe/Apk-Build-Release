/**
 * 构建耗时与时间点的显示格式。
 * 统一放一处：构建记录面板与队列面板都要显示同一个变体的耗时，不能各写一份。
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 耗时：8s / 3m38s / 1h02m03s。配 tabular-nums 使用，位数不跳 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return '—'
  }

  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h${pad2(minutes)}m${pad2(seconds)}s`
  }
  return `${minutes}m${pad2(seconds)}s`
}

/** 完成时刻：19:12:34（同一天内够用，日期另外用 formatDateTime） */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 日期 + 时刻：10-13 19:12 */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 已经跑掉的毫秒数：跑完取 finishedAt，跑着就取 now */
export function elapsedMs(
  span: { startedAt: number; finishedAt: number | null },
  now: number
): number {
  return Math.max(0, (span.finishedAt ?? now) - span.startedAt)
}
