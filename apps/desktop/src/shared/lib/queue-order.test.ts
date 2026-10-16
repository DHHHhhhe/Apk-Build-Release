import { describe, expect, it } from 'vitest'
import type { QueueItem, QueueItemState } from '../types/queue'
import { sortQueueItems } from './queue-order'

function item(
  id: string,
  state: QueueItemState,
  times: { enqueuedAt: number; startedAt?: number | null; finishedAt?: number | null }
): QueueItem {
  return {
    id,
    projectId: 'p1',
    projectName: '示例',
    projectPath: 'C:/projects/sample-a',
    state,
    variants: ['demoDebug'],
    attempt: 1,
    enqueuedAt: times.enqueuedAt,
    startedAt: times.startedAt ?? null,
    finishedAt: times.finishedAt ?? null,
    note: null,
    runs: []
  }
}

const ids = (items: QueueItem[]): string[] => items.map((entry) => entry.id)

describe('队列列表排序规则', () => {
  it('正在构建 → 排队中 → 已结束', () => {
    const items = [
      item('done', 'canceled', { enqueuedAt: 1, finishedAt: 5 }),
      item('wait', 'pending', { enqueuedAt: 2 }),
      item('run', 'running', { enqueuedAt: 3, startedAt: 10 })
    ]
    expect(ids(sortQueueItems(items))).toEqual(['run', 'wait', 'done'])
  })

  it('排队中按先入队在前（FIFO），与调度器取任务顺序一致', () => {
    const items = [
      item('later', 'pending', { enqueuedAt: 300 }),
      item('earlier', 'pending', { enqueuedAt: 100 }),
      item('middle', 'pending', { enqueuedAt: 200 })
    ]
    expect(ids(sortQueueItems(items))).toEqual(['earlier', 'middle', 'later'])
  })

  it('同时跑多个时先开始的在前', () => {
    const items = [
      item('second', 'running', { enqueuedAt: 1, startedAt: 900 }),
      item('first', 'running', { enqueuedAt: 2, startedAt: 100 })
    ]
    expect(ids(sortQueueItems(items))).toEqual(['first', 'second'])
  })

  it('已结束的按最近完成在前，成功/失败/取消同属一组', () => {
    const items = [
      item('old', 'success', { enqueuedAt: 1, finishedAt: 100 }),
      item('newest', 'failed', { enqueuedAt: 2, finishedAt: 900 }),
      item('middle', 'canceled', { enqueuedAt: 3, finishedAt: 500 })
    ]
    expect(ids(sortQueueItems(items))).toEqual(['newest', 'middle', 'old'])
  })

  it('顺序稳定：同一份数据反复排结果一致，不因抖动让列表跳动', () => {
    const items = [
      item('b', 'pending', { enqueuedAt: 100 }),
      item('a', 'pending', { enqueuedAt: 100 })
    ]
    const first = ids(sortQueueItems(items))
    const second = ids(sortQueueItems([...items].reverse()))
    expect(first).toEqual(['a', 'b'])
    expect(second).toEqual(first)
  })

  it('不修改传入的数组', () => {
    const items = [item('b', 'pending', { enqueuedAt: 2 }), item('a', 'running', { enqueuedAt: 1, startedAt: 1 })]
    sortQueueItems(items)
    expect(ids(items)).toEqual(['b', 'a'])
  })
})