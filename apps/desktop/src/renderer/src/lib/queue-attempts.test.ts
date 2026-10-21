import { describe, expect, it } from 'vitest'
import type { QueueItem } from '@shared/types/queue'
import { groupAttempts } from './queue-attempts'

function item(
  id: string,
  state: QueueItem['state'],
  enqueuedAt: number,
  extra: Partial<Pick<QueueItem, 'batchId' | 'projectId' | 'attempt' | 'variants'>> = {}
): QueueItem {
  return {
    id,
    projectId: extra.projectId ?? 'p1',
    projectName: '示例',
    projectPath: 'C:/projects/sample-a',
    state,
    batchId: extra.batchId === undefined ? 'batch-1' : extra.batchId,
    variants: extra.variants ?? ['demoRelease'],
    attempt: extra.attempt ?? 1,
    enqueuedAt,
    startedAt: null,
    finishedAt: null,
    note: null,
    runs: []
  }
}

describe('groupAttempts', () => {
  it('同一项目同一批的失败与重试合成一条，旧的那条收起来', () => {
    const items = [
      item('second', 'success', 200, { attempt: 2 }),
      item('first', 'failed', 100, { attempt: 1 })
    ]
    const split = groupAttempts(items)
    expect(split.primary.map((entry) => entry.id)).toEqual(['second'])
    expect(split.superseded.map((entry) => entry.id)).toEqual(['first'])
    expect(split.summaries.get('second')).toEqual({ earlierCount: 1, scopeSize: 1, rerunSize: 1 })
  })

  it('补跑部分变体时，能看到这次只覆盖了几个', () => {
    const items = [
      item('second', 'success', 200, {
        attempt: 2,
        variants: ['lateRelease'],
        projectId: 'p2'
      }),
      item('first', 'failed', 100, {
        attempt: 1,
        variants: ['freeRelease', 'paidRelease', 'lateRelease'],
        projectId: 'p2'
      })
    ]
    const split = groupAttempts(items)
    expect(split.summaries.get('second')).toEqual({ earlierCount: 1, scopeSize: 3, rerunSize: 1 })
  })

  it('组里还有排队或构建中的项时，谁都不折叠', () => {
    const items = [
      item('running', 'running', 300, { attempt: 3 }),
      item('failed', 'failed', 200, { attempt: 2 }),
      item('first', 'failed', 100, { attempt: 1 })
    ]
    const split = groupAttempts(items)
    expect(split.primary.map((entry) => entry.id)).toEqual(['running', 'failed', 'first'])
    expect(split.superseded).toHaveLength(0)
    expect(split.summaries.size).toBe(0)
  })

  it('不同项目各自成组，互不吞并', () => {
    const items = [
      item('a2', 'success', 200, { projectId: 'pa', attempt: 2 }),
      item('a1', 'failed', 100, { projectId: 'pa', attempt: 1 }),
      item('b1', 'failed', 150, { projectId: 'pb', attempt: 1 })
    ]
    const split = groupAttempts(items)
    expect(split.primary.map((entry) => entry.id)).toEqual(['a2', 'b1'])
    expect(split.superseded.map((entry) => entry.id)).toEqual(['a1'])
  })

  it('不同批次不合并', () => {
    const items = [
      item('new', 'success', 200, { batchId: 'batch-2' }),
      item('old', 'failed', 100, { batchId: 'batch-1' })
    ]
    const split = groupAttempts(items)
    expect(split.primary.map((entry) => entry.id)).toEqual(['new', 'old'])
    expect(split.superseded).toHaveLength(0)
  })

  it('没有 batchId 的老数据不合并', () => {
    const items = [
      item('second', 'success', 200, { batchId: null, attempt: 2 }),
      item('first', 'failed', 100, { batchId: null, attempt: 1 })
    ]
    const split = groupAttempts(items)
    expect(split.primary).toHaveLength(2)
    expect(split.superseded).toHaveLength(0)
  })

  it('同一批里重复入队（次数相同）时保留较晚的那条', () => {
    const items = [
      item('early', 'failed', 100, { attempt: 1 }),
      item('late', 'success', 200, { attempt: 1 })
    ]
    const split = groupAttempts(items)
    expect(split.primary.map((entry) => entry.id)).toEqual(['late'])
    expect(split.superseded.map((entry) => entry.id)).toEqual(['early'])
  })

  it('主列表保持原顺序', () => {
    const items = [
      item('x2', 'success', 400, { projectId: 'px', attempt: 2 }),
      item('x1', 'failed', 300, { projectId: 'px', attempt: 1 }),
      item('y1', 'success', 200, { projectId: 'py', attempt: 1 })
    ]
    expect(groupAttempts(items).primary.map((entry) => entry.id)).toEqual(['x2', 'y1'])
  })

  it('空输入不炸', () => {
    const split = groupAttempts([])
    expect(split.primary).toEqual([])
    expect(split.superseded).toEqual([])
    expect(split.summaries.size).toBe(0)
  })
})
