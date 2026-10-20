import { describe, expect, it } from 'vitest'
import type { QueueItem } from '@shared/types/queue'
import { mergeQueueItems, isStaleResponse } from './queue-merge'

function item(id: string, state: QueueItem['state'], enqueuedAt: number): QueueItem {
  return {
    id,
    projectId: 'p1',
    projectName: '示例',
    projectPath: 'C:/projects/sample-a',
    state,
    batchId: null,
    variants: ['demoDebug'],
    attempt: 1,
    enqueuedAt,
    startedAt: null,
    finishedAt: null,
    note: null,
    runs: []
  }
}

describe('乱序响应', () => {
  /**
   * 用户实测：先构建一批、没跑完再构建一批，第二项在队列里消失、侧栏也没徽章。
   * 根因是两个入队请求同时在飞，先发的响应带着更旧的快照后到，把后发的结果覆盖了。
   */
  it('比已应用的序号更旧＝过期响应，数据不能采用', () => {
    expect(isStaleResponse(1, 2)).toBe(true)
    expect(isStaleResponse(2, 2)).toBe(false)
    expect(isStaleResponse(3, 2)).toBe(false)
  })
})

describe('变更响应与事件推送的合并', () => {
  it('没有事件更新过时，直接用响应里的列表', () => {
    const previous = [item('a', 'pending', 1)]
    const incoming = [item('a', 'running', 1)]
    expect(mergeQueueItems(previous, incoming, new Set())).toEqual(incoming)
  })

  it('请求期间收到过事件的项，不被响应里的旧状态覆盖', () => {
    // 事件先到：a 已经 running；随后入队响应回来，里面 a 还是 pending
    const previous = [item('a', 'running', 1)]
    const incoming = [item('a', 'pending', 1)]
    const merged = mergeQueueItems(previous, incoming, new Set(['a']))
    expect(merged.find((entry) => entry.id === 'a')?.state).toBe('running')
  })

  it('没被事件更新过的项照旧用响应里的版本', () => {
    const previous = [item('a', 'running', 1), item('b', 'pending', 2)]
    const incoming = [item('a', 'pending', 1), item('b', 'pending', 2)]
    const merged = mergeQueueItems(previous, incoming, new Set(['a']))
    expect(merged.find((entry) => entry.id === 'a')?.state).toBe('running')
    expect(merged.find((entry) => entry.id === 'b')?.state).toBe('pending')
  })

  it('响应里没有、但事件刚推来的项要保留', () => {
    const previous = [item('a', 'running', 1), item('b', 'pending', 2)]
    const incoming = [item('a', 'pending', 1)]
    const merged = mergeQueueItems(previous, incoming, new Set(['b']))
    expect(merged.map((entry) => entry.id).sort()).toEqual(['a', 'b'])
  })

  // 排序规则统一到 shared/lib/queue-order 之后，这条跟着改：
  // 以前断言的是「按入队时间倒序」，那正是用户说「排序规则不明确」的那个顺序
  it('结果按统一规则排序（构建中 → 排队中 → 已结束）', () => {
    const previous = [item('a', 'running', 1), item('b', 'pending', 9)]
    const incoming = [item('a', 'pending', 1), item('b', 'pending', 9)]
    const merged = mergeQueueItems(previous, incoming, new Set(['a']))
    expect(merged.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})