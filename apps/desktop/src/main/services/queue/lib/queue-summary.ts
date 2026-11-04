/**
 * 「整轮队列跑完了」的汇总。
 *
 * 单项通知只说自己那一项（哪个项目、几个变体成没成）。一次勾 5 个项目时，
 * 用户会收到 5 条这样的通知，最后还得自己心里加一遍总数 —— 所以队列整轮跑完
 * 再补一条总通知，一条说清这一轮到底出了多少包、挂没挂。
 *
 * 这里只做汇总与文案，不碰数据库也不弹通知（那两件事留给调用方 scheduler），
 * 「算得对不对」才能单测。
 */

export interface SummaryRun {
  /** 变体名；整项没跑起来（项目目录没了之类）时为空串 */
  variant: string
  state: string
  /** 结束时刻，用于同一变体的多次重试里挑最新那次；没有就取开始时刻，再没有就 0 */
  at: number | null
}

/** 汇总只需要两样东西：这一项属于哪个项目，以及它下面的每个变体 */
export interface SummarySource {
  projectId: string
  /** 项自己的结局；整项没跑起来时用它兜底，否则这种失败会被漏掉 */
  state: string
  runs: SummaryRun[]
}

export interface QueueSummary {
  /** 去重后的项目数 */
  projects: number
  variants: number
  success: number
  failed: number
  canceled: number
  /** 这一轮的总体结论，决定通知标题 */
  outcome: 'success' | 'failed' | 'canceled'
}

/**
 * 汇总这一轮参与的队列项。
 *
 * 一条项都没拿到时返回 null：没有任何东西可说，就不该弹一条空通知。
 *
 * 两个刻意的口径：
 * - **同一项目的同一变体只算一次**，取最新的那次。重试沿用原批次，一轮里就会出现
 *   「原来失败的那次 + 补跑成功的那次」，不去重会把 5 个变体说成 6 个；
 * - 被取消项里已经跑成功的变体仍计入 success —— 用户关心的是「实际出了几个包」，
 *   而不是「这一条项被标成了什么」。
 */
export function buildQueueSummary(items: SummarySource[]): QueueSummary | null {
  if (items.length === 0) {
    return null
  }

  const projectIds = new Set<string>()
  /** key = 项目 + 变体，同一 key 只留时刻最晚的那条 */
  const latest = new Map<string, SummaryRun>()

  for (const item of items) {
    projectIds.add(item.projectId)
    const runs: SummaryRun[] =
      item.runs.length > 0 ? item.runs : [{ variant: '', state: item.state, at: null }]
    for (const run of runs) {
      const key = `${item.projectId}|${run.variant}`
      const current = latest.get(key)
      if (!current || (run.at ?? 0) >= (current.at ?? 0)) {
        latest.set(key, run)
      }
    }
  }

  let success = 0
  let failed = 0
  let canceled = 0
  for (const run of latest.values()) {
    if (run.state === 'success') {
      success += 1
    } else if (run.state === 'failed') {
      failed += 1
    } else if (run.state === 'canceled') {
      canceled += 1
    }
  }

  return {
    projects: projectIds.size,
    variants: latest.size,
    success,
    failed,
    canceled,
    outcome: judgeOutcome({ success, failed, canceled })
  }
}

/**
 * 总体结论。
 *
 * 全取消与「取消了一部分但有成功」要分开：前者是用户自己按的，标题不该写「失败」；
 * 后者仍是一条有产出的通知，按失败算会让用户以为整批白跑。
 */
function judgeOutcome(counts: {
  success: number
  failed: number
  canceled: number
}): QueueSummary['outcome'] {
  if (counts.success === 0 && counts.failed === 0 && counts.canceled > 0) {
    return 'canceled'
  }
  if (counts.failed > 0) {
    return 'failed'
  }
  return 'success'
}

export interface QueueNotification {
  title: string
  body: string
}

/** 通知文案：标题只给结论，数量与明细放正文，一行读完 */
export function queueSummaryNotification(summary: QueueSummary): QueueNotification {
  const title =
    summary.outcome === 'success'
      ? '队列构建完成'
      : summary.outcome === 'canceled'
        ? '队列构建已全部取消'
        : '队列构建完成，有变体失败'

  const parts = [
    `${summary.projects} 个项目`,
    `${summary.variants} 个变体：成功 ${summary.success}、失败 ${summary.failed}`
  ]
  if (summary.canceled > 0) {
    parts.push(`取消 ${summary.canceled}`)
  }

  return { title, body: parts.join(' · ') }
}