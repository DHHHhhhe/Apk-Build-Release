import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueItem, QueueRunDetail } from '@shared/types/queue'

const mocks = vi.hoisted(() => ({
  items: vi.fn<() => QueueItem[]>(() => []),
  setProgressBar: vi.fn(),
  windows: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: mocks.windows } }))
vi.mock('./items', () => ({ listItems: mocks.items }))

import { syncTaskbarProgress } from './progress'

const NOW = 1_000_000

function run(patch: Partial<QueueRunDetail> = {}): QueueRunDetail {
  return {
    id: 'run-1', variant: 'freeRelease', state: 'running',
    startedAt: NOW - 22_000, estimatedMs: 100_000, durationMs: null,
    failureKind: null, failureHint: null, apkName: null, apkPath: null, logPath: null,
    ...patch
  }
}

function item(patch: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1', projectId: 'project-1', projectName: '示例',
    projectPath: 'C:/projects/sample-a', state: 'running', batchId: 'batch-current',
    variants: ['freeRelease'], attempt: 1, enqueuedAt: NOW - 30_000,
    startedAt: NOW - 22_000, finishedAt: null, note: null, runs: [run()],
    ...patch
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.windows.mockReturnValue([{ setProgressBar: mocks.setProgressBar }])
  mocks.items.mockClear()
  mocks.items.mockReturnValue([])
  mocks.setProgressBar.mockClear()
})

afterEach(() => {
  mocks.items.mockReturnValue([])
  syncTaskbarProgress()
  vi.useRealTimers()
})

describe('任务栏与队列变体进度一致', () => {
  it('历史记录不参与当前批次，单变体 22% 就显示 22%', () => {
    mocks.items.mockReturnValue([
      item(),
      item({ id: 'old', projectId: 'old-project', state: 'success', batchId: 'batch-old',
        enqueuedAt: 1, runs: [run({ state: 'success' })] })
    ])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(0.22)
  })

  it('没有新的 Gradle 输出时，仍每秒按已用时间更新', () => {
    mocks.items.mockReturnValue([item()])
    syncTaskbarProgress()
    vi.advanceTimersByTime(1000)
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(0.23)
    expect(mocks.items).toHaveBeenCalledTimes(1)
  })

  it('多个变体按已结束、正在构建和未开始的进度汇总', () => {
    mocks.items.mockReturnValue([item({
      variants: ['demoRelease', 'freeRelease', 'paidRelease'],
      runs: [run({ id: 'done', variant: 'demoRelease', state: 'success' }), run()]
    })])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(0.4066666666666667)
  })

  it('重试只统计当前尝试，旧失败记录不抬高进度', () => {
    mocks.items.mockReturnValue([
      item({ attempt: 2 }),
      item({ id: 'first', attempt: 1, state: 'failed', enqueuedAt: 1,
        runs: [run({ state: 'failed' })] })
    ])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(0.22)
  })

  it('缺少耗时样本时显示不定进度', () => {
    mocks.items.mockReturnValue([item({ runs: [run({ estimatedMs: null })] })])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(2)
  })

  it.each(['success', 'failed', 'canceled'] as const)('%s 后清除进度并停止心跳', (state) => {
    mocks.items.mockReturnValue([item()])
    syncTaskbarProgress()
    mocks.items.mockReturnValue([item({ state, runs: [run({ state })] })])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(-1)
    const calls = mocks.setProgressBar.mock.calls.length
    vi.advanceTimersByTime(5000)
    expect(mocks.setProgressBar).toHaveBeenCalledTimes(calls)
  })

  it('排队但未开始时进度为零', () => {
    mocks.items.mockReturnValue([item({ state: 'pending', runs: [] })])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(0)
  })

  it('清空队列后停止心跳', () => {
    mocks.items.mockReturnValue([item()])
    syncTaskbarProgress()
    mocks.items.mockReturnValue([])
    syncTaskbarProgress()
    expect(mocks.setProgressBar).toHaveBeenLastCalledWith(-1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('没有窗口时不保留心跳', () => {
    mocks.items.mockReturnValue([item()])
    syncTaskbarProgress()
    mocks.windows.mockReturnValue([])
    vi.advanceTimersByTime(1000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
