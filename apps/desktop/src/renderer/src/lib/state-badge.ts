import type { BuildRunState } from '@shared/types/build'
import type { EnvItemState } from '@shared/types/env'
import type { QueueItemState } from '@shared/types/queue'

/**
 * 状态 → 徽章类名。
 *
 * 这段逻辑本来在四个面板里各写了一遍（构建面板、队列面板、汇总面板三份逐字相同，
 * 环境卡片一份是另一套映射）。收在一处之后，加一个状态只改这里。
 *
 * 参数取 BuildRunState | QueueItemState：队列项的联合类型更宽（多了 pending），
 * 而这里只区分 success / failed / running，其余一律落到 muted，所以放宽是安全的。
 *
 * 为什么不返回 Badge 的 variant 而是类名：这几个调用点是 className={…} 直接插进
 * 既有 JSX 的，改签名要同时动四处标签。先用共享函数消掉重复，换组件那步单独做。
 */
export function buildStateBadgeClass(state: BuildRunState | QueueItemState): string {
  if (state === 'success') {
    return 'badge badge--success'
  }
  if (state === 'failed') {
    return 'badge badge--destructive'
  }
  if (state === 'running') {
    return 'badge badge--info'
  }
  return 'badge badge--muted'
}

/** 环境探测的三档：通过 / 需要注意 / 缺失。与构建状态不是同一套语义，所以单独一支。 */
export function envStateBadgeClass(state: EnvItemState): string {
  if (state === 'ok') {
    return 'badge badge--success'
  }
  if (state === 'warn') {
    return 'badge badge--warning'
  }
  return 'badge badge--destructive'
}