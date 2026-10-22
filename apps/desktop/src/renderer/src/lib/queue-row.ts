import type { QueueItem, QueueRunDetail } from '@shared/types/queue'
import { formatDurationMs } from './duration'

/**
 * 队列与构建中心的**呈现规则**（纯函数，全部可单测）。
 *
 * 放在这里而不是组件里，是因为这些规则带着容易被改错的口径：
 * 「单变体」看的是声明的变体数而不是已开始的记录数、等待时长有显示阈值、
 * 时间文案有三种状态三套说法。写进组件就只能靠肉眼回归。
 */

/** 等待时长小于这个值就不提「等待」：`等待 0s` 是纯噪音，而且几乎每个变体都会出现 */
export const WAIT_DISPLAY_MIN_MS = 1000

/**
 * 这个队列项是不是「单变体项」——决定渲染成一行还是「头行 + 子行」。
 *
 * 必须看 `variants`（入队时冻结的声明列表），不能看 `runs`：
 * 还没开跑的项 `runs` 是空的，用它判断会把 pending 项当成多变体、平白多出一行。
 */
export function isSingleVariantItem(item: Pick<QueueItem, 'variants'>): boolean {
  return item.variants.length === 1
}

export interface VariantTimingInput {
  state: QueueRunDetail['state']
  /** 这个变体开始构建的时刻；还没开始为 null */
  startedAt: number | null
  /** 跑完才有；跑着的由 now 现算 */
  durationMs: number | null
  /** 历史中位数预估；没有样本为 null */
  estimatedMs: number | null
  /**
   * 从「这一项入队」到「这个变体开始」的时长。
   * 它包含前面变体的构建时间 —— 所以文案叫「等待」而不是「排队」：
   * 说「排队」会让人以为这一项在排队，实际口径更大。
   */
  waitMs: number | null
  /** 设置里关掉进度条时，整段预估文案也不出现 */
  showEstimate: boolean
  now: number
}

/**
 * 一个变体的时间文案：
 * - 运行中：`等待 4s · 构建 21s · 预计 5m00s`（等待 <1s 时省略；超出预估改「已超出预计」）
 * - 已结束：`耗时 3m00s`
 * - 未开始：`未开始`
 */
export function variantTimingText(input: VariantTimingInput): string {
  const { state, startedAt, durationMs, estimatedMs, waitMs, showEstimate, now } = input

  if (state === 'running' && startedAt !== null) {
    const parts: string[] = []
    if (waitMs !== null && waitMs >= WAIT_DISPLAY_MIN_MS) {
      parts.push(`等待 ${formatDurationMs(waitMs)}`)
    }
    const elapsed = Math.max(0, now - startedAt)
    parts.push(`构建 ${formatDurationMs(elapsed)}`)
    if (showEstimate && estimatedMs !== null) {
      parts.push(
        elapsed > estimatedMs
          ? `已超出预计 ${formatDurationMs(estimatedMs)}`
          : `预计 ${formatDurationMs(estimatedMs)}`
      )
    }
    return parts.join(' · ')
  }

  if (durationMs !== null) {
    return `耗时 ${formatDurationMs(durationMs)}`
  }
  return '未开始'
}

/**
 * 构建中心顶部的计数。
 *
 * 相等时只说一个数 —— `已选 8 / 可构建 8` 这种写法让人以为两个数总有区别；
 * 不等时才把差额说出来（`待入队 6`），这才是用户真正需要知道的。
 */
export function pickerCountText(selectedCount: number, buildableVariantCount: number): string {
  if (selectedCount === buildableVariantCount) {
    return `已选 ${selectedCount}`
  }
  return `已选 ${selectedCount} · 待入队 ${buildableVariantCount}`
}

export type StatusBadgeTone = 'info' | 'success' | 'muted'

/**
 * 左侧项目卡的状态徽章。
 *
 * 单变体项目以前恒定显示「1 个变体」+「已选 1」两个徽章 —— 前者永远等于 1、
 * 后者与勾选状态同义，两个加起来信息量为零。现在只给一个有信息量的。
 */
export function projectStatusBadge(input: {
  /** 参与打包的变体数 */
  variantCount: number
  selectedCount: number
  /** 这个项目有没跑完的队列项 */
  inQueue: boolean
}): { label: string; tone: StatusBadgeTone } {
  if (input.inQueue) {
    return { label: '队列中', tone: 'info' }
  }
  if (input.variantCount > 1) {
    return {
      label: `已选 ${input.selectedCount}/${input.variantCount}`,
      tone: input.selectedCount > 0 ? 'success' : 'muted'
    }
  }
  return input.selectedCount > 0
    ? { label: '已选', tone: 'success' }
    : { label: '未选', tone: 'muted' }
}
