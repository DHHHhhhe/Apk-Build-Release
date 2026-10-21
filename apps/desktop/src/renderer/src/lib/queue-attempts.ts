import type { QueueItem } from '@shared/types/queue'

/** 合并之后一组内被代表项「顶掉」的旧尝试的统计 */
export interface AttemptGroupSummary {
  /** 收进「更早的尝试」里的条数 */
  earlierCount: number
  /** 这一组前后覆盖过的变体总数（各次尝试取并集） */
  scopeSize: number
  /** 代表项这次覆盖了几个变体：比 scopeSize 小就说明是「只补跑失败的变体」 */
  rerunSize: number
}

export interface AttemptSplit {
  /** 主列表要显示的项（每组一条） */
  primary: QueueItem[]
  /** 被收起来的旧尝试 */
  superseded: QueueItem[]
  /** 代表项 id → 这一组的统计；界面用它提示「还有几次更早的尝试」「本次只补跑了几个」 */
  summaries: Map<string, AttemptGroupSummary>
}

function isActive(item: QueueItem): boolean {
  return item.state === 'pending' || item.state === 'running'
}

/**
 * 同一批 + 同一项目才算同一组。
 *
 * 重试沿用原项的 batchId，所以「失败一次再重试」的两条项落在同一个 key 上；
 * 不同批次之间各是各的，不能合并。
 */
function groupKey(item: QueueItem): string | null {
  // 老数据没有 batchId：判断不了是不是同一条重试链，各自独立显示
  if (item.batchId === null) {
    return null
  }
  return item.batchId + '\u0000' + item.projectId
}

/** 组内代表：试得最晚的那次；次数相同（同一批里重复入队）时取较晚入队的 */
function preferred(left: QueueItem, right: QueueItem): QueueItem {
  if (left.attempt !== right.attempt) {
    return left.attempt > right.attempt ? left : right
  }
  return left.enqueuedAt >= right.enqueuedAt ? left : right
}

/**
 * 把同一条重试链上的多条队列项合并成一条展示。
 *
 * 「重试」是新建一条队列项（attempt + 1），原来那条留在队列里 —— 好处是上一次的失败原因、
 * 日志路径、产物路径都还查得到（构建记录挂在队列项下，删了就一起没），
 * 坏处是同一项目会并排出现「成功」「失败」两张卡片，看着像重复。
 *
 * 这里只处理展示：每组留下 attempt 最大的那条，旧的收进「更早的尝试」。
 * 两条不折叠的例外：
 * 1. 组里还有排队或构建中的项 —— 正在跑的不能被藏起来；
 * 2. 没有 batchId 的老数据 —— 判断不了是不是同一条链，宁可多显示。
 */
export function groupAttempts(items: QueueItem[]): AttemptSplit {
  const buckets = new Map<string, QueueItem[]>()
  for (const item of items) {
    const key = groupKey(item)
    if (key === null) {
      continue
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [item])
    } else {
      bucket.push(item)
    }
  }

  const chosen = new Map<string, QueueItem>()
  const supersededIds = new Set<string>()
  const summaries = new Map<string, AttemptGroupSummary>()

  for (const [key, bucket] of buckets) {
    if (bucket.some(isActive)) {
      continue
    }

    const head = bucket[0]
    if (head === undefined) {
      continue
    }
    let best = head
    const variants = new Set<string>()
    for (const item of bucket) {
      best = preferred(item, best)
      for (const variant of item.variants) {
        variants.add(variant)
      }
    }
    chosen.set(key, best)

    for (const item of bucket) {
      if (item.id !== best.id) {
        supersededIds.add(item.id)
      }
    }
    summaries.set(best.id, {
      earlierCount: bucket.length - 1,
      scopeSize: variants.size,
      rerunSize: best.variants.length
    })
  }

  return {
    primary: items.filter((item) => {
      const key = groupKey(item)
      if (key === null) {
        return true
      }
      const best = chosen.get(key)
      // 组里有活跃项时这里取不到 key：全都留在主列表
      return best === undefined || item.id === best.id
    }),
    superseded: items.filter((item) => supersededIds.has(item.id)),
    summaries
  }
}
