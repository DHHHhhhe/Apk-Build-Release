import { describe, expect, it } from 'vitest'
import { buildQueueSummary, queueSummaryNotification } from './queue-summary'

/**
 * 整轮队列的总通知。
 *
 * 要挡住的错法有四种，都在下面：
 * 1. 重试沿用原批次，同一变体在一轮里出现两次 → 数量翻倍；
 * 2. 同一项目建了两条项 → 项目数翻倍；
 * 3. 全取消被写成「失败」（那是用户自己按的）；
 * 4. 有取消也有成功时被当成「整批白跑」。
 */
describe('整轮队列汇总', () => {
  it('跨项目汇总变体结果', () => {
    const summary = buildQueueSummary([
      {
        projectId: 'p1',
        state: 'success',
        runs: [
          { variant: 'freeRelease', state: 'success', at: 1 },
          { variant: 'paidRelease', state: 'failed', at: 2 }
        ]
      },
      {
        projectId: 'p2',
        state: 'success',
        runs: [{ variant: 'freeRelease', state: 'success', at: 3 }]
      }
    ])

    expect(summary).toMatchObject({
      projects: 2,
      variants: 3,
      success: 2,
      failed: 1,
      canceled: 0,
      outcome: 'failed'
    })
  })

  it('同一变体的重试只算一次，取最新那次的结果', () => {
    const summary = buildQueueSummary([
      { projectId: 'p1', state: 'failed', runs: [{ variant: 'freeRelease', state: 'failed', at: 100 }] },
      { projectId: 'p1', state: 'success', runs: [{ variant: 'freeRelease', state: 'success', at: 200 }] }
    ])

    expect(summary?.variants).toBe(1)
    expect(summary?.success).toBe(1)
    expect(summary?.failed).toBe(0)
    // 重试是同一个项目的补跑，不该把项目数算成 2
    expect(summary?.projects).toBe(1)
    expect(summary?.outcome).toBe('success')
  })

  it('整项没跑起来时按项的状态兜底，不会被漏掉', () => {
    const summary = buildQueueSummary([{ projectId: 'p1', state: 'failed', runs: [] }])

    expect(summary?.variants).toBe(1)
    expect(summary?.failed).toBe(1)
    expect(summary?.outcome).toBe('failed')
  })

  it('全部取消的结论是「已取消」，不是「失败」', () => {
    const summary = buildQueueSummary([
      { projectId: 'p1', state: 'canceled', runs: [{ variant: 'freeRelease', state: 'canceled', at: 1 }] }
    ])

    expect(summary?.outcome).toBe('canceled')
    expect(queueSummaryNotification(summary!).title).toBe('队列构建已全部取消')
  })

  it('取消一部分但出了包：仍算完成，不当成整批白跑', () => {
    const summary = buildQueueSummary([
      {
        projectId: 'p1',
        state: 'canceled',
        runs: [
          { variant: 'freeRelease', state: 'success', at: 1 },
          { variant: 'paidRelease', state: 'canceled', at: 2 }
        ]
      }
    ])

    expect(summary?.outcome).toBe('success')
    expect(summary?.success).toBe(1)
    expect(summary?.canceled).toBe(1)
  })

  it('一条项都没有就不出通知', () => {
    expect(buildQueueSummary([])).toBeNull()
  })
})

describe('总通知的文案', () => {
  it('正文把项目数、变体数与成功/失败都写出来，取消为 0 时不提', () => {
    const summary = buildQueueSummary([
      {
        projectId: 'p1',
        state: 'success',
        runs: [
          { variant: 'a', state: 'success', at: 1 },
          { variant: 'b', state: 'success', at: 2 }
        ]
      },
      { projectId: 'p2', state: 'success', runs: [{ variant: 'a', state: 'success', at: 3 }] }
    ])
    const notification = queueSummaryNotification(summary!)

    expect(notification.title).toBe('队列构建完成')
    expect(notification.body).toBe('2 个项目 · 3 个变体：成功 3、失败 0')
  })
})