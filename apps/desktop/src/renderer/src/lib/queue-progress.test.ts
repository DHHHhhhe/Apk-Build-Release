import { describe, expect, it } from 'vitest'
import type { QueueItem, QueueRunDetail } from '@shared/types/queue'
import { computeBatchProgress } from './queue-progress'

function run(variant: string, state: QueueRunDetail['state']): QueueRunDetail {
  return {
    id: 'run-' + variant,
    variant,
    state,
    startedAt: null,
    durationMs: null,
    estimatedMs: null,
    failureKind: null,
    failureHint: null,
    apkName: null,
    apkPath: null,
    logPath: null
  }
}

function item(
  id: string,
  state: QueueItem['state'],
  enqueuedAt: number,
  variants: string[],
  runs: QueueRunDetail[],
  extra: Partial<Pick<QueueItem, 'batchId' | 'projectId' | 'attempt' | 'finishedAt'>> = {}
): QueueItem {
  return {
    id,
    projectId: extra.projectId ?? 'proj-' + id,
    projectName: '示例',
    projectPath: 'C:/projects/sample-a',
    state,
    batchId: extra.batchId === undefined ? 'batch-1' : extra.batchId,
    variants,
    attempt: extra.attempt ?? 1,
    enqueuedAt,
    startedAt: null,
    finishedAt: extra.finishedAt ?? null,
    note: null,
    runs
  }
}

describe('computeBatchProgress', () => {
  it('每项一个变体时，跑完的项仍留在分母里', () => {
    // 复现：8 个项目各打 1 个变体，跑了 5 个 —— 以前会显示 0/3
    const items: QueueItem[] = []
    for (let index = 0; index < 8; index += 1) {
      const finished = index < 5
      items.push(
        item(
          'i' + index,
          finished ? 'success' : index === 5 ? 'running' : 'pending',
          index,
          ['demoRelease'],
          finished
            ? [run('demoRelease', 'success')]
            : index === 5
              ? [run('demoRelease', 'running')]
              : [],
          { finishedAt: finished ? index * 1000 + 500 : null }
        )
      )
    }
    expect(computeBatchProgress(items)).toEqual({
      total: 8,
      done: 5,
      running: 1,
      // 还有项没跑完：until 留空，界面用 now 兜底
      since: 0,
      until: null
    })
  })

  it('同一项里多个变体时按变体计数，不是按项计数', () => {
    const items = [
      item('a', 'running', 1000, ['freeRelease', 'paidRelease', 'demoRelease'], [
        run('freeRelease', 'success'),
        run('paidRelease', 'failed'),
        run('demoRelease', 'running')
      ])
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 3,
      done: 2,
      running: 1,
      since: 1000,
      until: null
    })
  })

  it('整批收工后仍给出这一批的起止，供「本批用时」继续显示', () => {
    const items = [
      item('a', 'success', 1000, ['demoRelease'], [run('demoRelease', 'success')], {
        finishedAt: 5000
      }),
      item('b', 'failed', 2000, ['demoRelease'], [run('demoRelease', 'failed')], {
        finishedAt: 9000
      })
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 2,
      done: 2,
      running: 0,
      since: 1000,
      // 收工后封口：不再跟着当前时间涨
      until: 9000
    })
  })

  it('重试新建的项沿用 batchId，不会让分母翻倍；起算时间仍是最早那次入队', () => {
    const items = [
      item('first', 'failed', 1000, ['demoRelease'], [run('demoRelease', 'failed')], {
        projectId: 'p1',
        attempt: 1,
        finishedAt: 2000
      }),
      item('retry', 'running', 5000, ['demoRelease'], [run('demoRelease', 'running')], {
        projectId: 'p1',
        attempt: 2
      })
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 1,
      done: 0,
      running: 1,
      since: 1000,
      until: null
    })
  })

  it('只看当前批：更早批次的项不进分母，也不影响起算时间', () => {
    const items = [
      item('old', 'success', 1, ['demoRelease'], [run('demoRelease', 'success')], {
        batchId: 'batch-old',
        finishedAt: 900
      }),
      item('now', 'running', 2000, ['demoRelease'], [run('demoRelease', 'running')], {
        batchId: 'batch-new'
      })
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 1,
      done: 0,
      running: 1,
      since: 2000,
      until: null
    })
  })

  it('没有 batchId 的老数据只在有未结束项时统计', () => {
    const items = [
      item('old', 'success', 1, ['demoRelease'], [run('demoRelease', 'success')], {
        batchId: null,
        finishedAt: 500
      }),
      item('now', 'pending', 2000, ['demoRelease'], [], { batchId: null })
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 1,
      done: 0,
      running: 0,
      since: 2000,
      until: null
    })
  })

  it('老数据全部结束时划不出批次，不给时间', () => {
    const items = [
      item('a', 'success', 1, ['demoRelease'], [run('demoRelease', 'success')], {
        batchId: null,
        finishedAt: 500
      })
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 0,
      done: 0,
      running: 0,
      since: null,
      until: null
    })
  })

  it('分子不超过分母', () => {
    const items = [
      item('a', 'running', 1000, ['demoRelease'], [
        run('demoRelease', 'success'),
        run('demoRelease', 'success')
      ])
    ]
    expect(computeBatchProgress(items)).toEqual({
      total: 1,
      done: 1,
      running: 0,
      since: 1000,
      until: null
    })
  })

  it('空队列不炸', () => {
    expect(computeBatchProgress([])).toEqual({
      total: 0,
      done: 0,
      running: 0,
      since: null,
      until: null
    })
  })
})
