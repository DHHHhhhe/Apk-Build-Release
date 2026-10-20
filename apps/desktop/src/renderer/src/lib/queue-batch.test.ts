import { describe, expect, it } from 'vitest'
import type { QueueItem } from '@shared/types/queue'
import { splitByCurrentBatch } from './queue-batch'

function item(
  id: string,
  state: QueueItem['state'],
  enqueuedAt: number,
  batchId: string | null
): QueueItem {
  return {
    id,
    projectId: 'p1',
    projectName: '示例',
    projectPath: 'C:/projects/sample-a',
    state,
    batchId,
    variants: ['demoRelease'],
    attempt: 1,
    enqueuedAt,
    startedAt: null,
    finishedAt: null,
    note: null,
    runs: []
  }
}

describe('splitByCurrentBatch', () => {
  it('全部完成时，当前批次是最近入队的那一批', () => {
    const items = [
      item('a', 'success', 100, 'batch-old'),
      item('b', 'success', 200, 'batch-new'),
      item('c', 'success', 201, 'batch-new')
    ]
    const split = splitByCurrentBatch(items)
    expect(split.current.map((entry) => entry.id)).toEqual(['b', 'c'])
    expect(split.older.map((entry) => entry.id)).toEqual(['a'])
  })

  it('不同批次的未结束项都留在当前区，不会被收进折叠区', () => {
    const items = [
      item('running', 'running', 100, 'batch-a'),
      item('queued', 'pending', 300, 'batch-b')
    ]
    const split = splitByCurrentBatch(items)
    expect(split.current.map((entry) => entry.id).sort()).toEqual(['queued', 'running'])
    expect(split.older).toHaveLength(0)
  })

  it('追加进同一批次时不会把前一批踢进「更早」', () => {
    const items = [
      item('first', 'running', 100, 'batch-a'),
      item('appended', 'pending', 200, 'batch-a'),
      item('old', 'success', 50, 'batch-z')
    ]
    const split = splitByCurrentBatch(items)
    expect(split.current.map((entry) => entry.id).sort()).toEqual(['appended', 'first'])
    expect(split.older.map((entry) => entry.id)).toEqual(['old'])
  })

  it('老数据没有批次字段时不分，全部照旧显示', () => {
    const items = [item('a', 'success', 100, null), item('b', 'success', 200, null)]
    const split = splitByCurrentBatch(items)
    expect(split.current).toHaveLength(2)
    expect(split.older).toHaveLength(0)
  })

  it('空队列不炸', () => {
    expect(splitByCurrentBatch([])).toEqual({ current: [], older: [] })
  })
})
