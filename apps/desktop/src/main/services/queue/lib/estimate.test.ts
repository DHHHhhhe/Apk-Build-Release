import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let schema: typeof import('../../../db/schema')
let estimate: typeof import('./estimate')

/** 造一条队列项 + 一条构建记录；同一个变体的历史就是多次调用它 */
function addRun(
  projectId: string,
  variant: string,
  state: 'success' | 'failed' | 'canceled' | 'running',
  durationMs: number,
  finishedBase: number
): void {
  const itemId = `item-${projectId}-${variant}-${finishedBase}-${state}`
  const runId = `run-${projectId}-${variant}-${finishedBase}-${state}`
  dbModule.db
    .insert(schema.queueItems)
    .values({ id: itemId, projectId, state: 'success', variants: JSON.stringify([variant]) })
    .run()
  dbModule.db
    .insert(schema.buildRuns)
    .values({
      id: runId,
      queueItemId: itemId,
      variant,
      state,
      startedAt: new Date(finishedBase - durationMs),
      finishedAt: state === 'running' ? null : new Date(finishedBase)
    })
    .run()
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-estimate-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  schema = await import('../../../db/schema')
  estimate = await import('./estimate')

  dbModule.db
    .insert(schema.projects)
    .values([
      { id: 'project-a', name: '项目 A', path: join(workspace, 'a'), selectedVariants: '[]' },
      { id: 'project-b', name: '项目 B', path: join(workspace, 'b'), selectedVariants: '[]' }
    ])
    .run()
})

afterAll(() => {
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('median', () => {
  it('奇数个取中间值，偶数个取中间两个的均值', () => {
    expect(estimate.median([300, 100, 200])).toBe(200)
    expect(estimate.median([400, 100, 300, 200])).toBe(250)
  })

  it('空数组返回 null，不返回 0', () => {
    expect(estimate.median([])).toBeNull()
  })

  it('不去修改传入的数组', () => {
    const input = [3, 1, 2]
    estimate.median(input)
    expect(input).toEqual([3, 1, 2])
  })
})

describe('estimateFromDurations', () => {
  it('丢掉非正耗时：时钟回拨、同毫秒开始结束都不该把预估拉到 0', () => {
    expect(estimate.estimateFromDurations([0, -5, Number.NaN, 60_000])).toEqual({
      medianMs: 60_000,
      samples: 1
    })
  })

  it('只取最近的 10 条（入参是新的在前）', () => {
    const durations = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((value) => value * 1000)
    const result = estimate.estimateFromDurations(durations)
    // 最近 10 条是 11000..2000，中位数落在 6000 与 7000 之间
    expect(result).toEqual({ medianMs: 6_500, samples: 10 })
  })

  it('全是无效耗时返回 null', () => {
    expect(estimate.estimateFromDurations([0, 0])).toBeNull()
  })
})

describe('loadVariantEstimates', () => {
  it('只统计成功构建，失败与取消不进样本', () => {
    const base = 1_000_000
    // 同一个项目 + 变体：成功 100s / 200s / 400s，外加一条失败与一条取消
    addRun('project-a', 'demoDebug', 'success', 100_000, base + 1_000_000)
    addRun('project-a', 'demoDebug', 'success', 200_000, base + 2_000_000)
    addRun('project-a', 'demoDebug', 'success', 400_000, base + 3_000_000)
    addRun('project-a', 'demoDebug', 'failed', 5_000, base + 4_000_000)
    addRun('project-a', 'demoDebug', 'canceled', 1_000, base + 5_000_000)

    const table = estimate.loadVariantEstimates(['project-a'])
    const found = table.get(estimate.estimateKey('project-a', 'demoDebug'))
    expect(found).toEqual({ medianMs: 200_000, samples: 3 })
  })

  it('同名的变体在不同项目里互不影响', () => {
    const base = 10_000_000
    addRun('project-b', 'demoDebug', 'success', 60_000, base + 1_000_000)

    const table = estimate.loadVariantEstimates(['project-a', 'project-b'])
    expect(table.get(estimate.estimateKey('project-a', 'demoDebug'))).toEqual({
      medianMs: 200_000,
      samples: 3
    })
    expect(table.get(estimate.estimateKey('project-b', 'demoDebug'))).toEqual({
      medianMs: 60_000,
      samples: 1
    })
  })

  it('样本超过上限时只取最近 10 次', () => {
    const base = 20_000_000
    // 12 次成功，耗时 1000..12000，序号越大越新
    for (let index = 0; index < 12; index += 1) {
      addRun('project-b', 'limitedVariant', 'success', (index + 1) * 1000, base + (index + 1) * 1_000_000)
    }

    const found = estimate
      .loadVariantEstimates(['project-b'])
      .get(estimate.estimateKey('project-b', 'limitedVariant'))
    // 最近 10 次是 3000..12000，中位数 = (7000 + 8000) / 2
    expect(found).toEqual({ medianMs: 7_500, samples: 10 })
  })

  it('没有成功历史（或只有跑着的）时给出 null，不编一个数', () => {
    addRun('project-b', 'onlyRunning', 'running', 30_000, 30_000_000)
    const table = estimate.loadVariantEstimates(['project-b'])
    expect(table.get(estimate.estimateKey('project-b', 'onlyRunning'))).toBeUndefined()
  })

  it('脏耗时不算进「最近 10 次」的名额', () => {
    const base = 50_000_000
    // 10 条干净耗时（1000..10000，越靠后越新），再加 2 条「同一毫秒开始并结束」的脏数据（更新）
    for (let index = 0; index < 10; index += 1) {
      addRun('project-b', 'dirtySlots', 'success', (index + 1) * 1000, base + (index + 1) * 1_000_000)
    }
    addRun('project-b', 'dirtySlots', 'success', 0, base + 20_000_000)
    addRun('project-b', 'dirtySlots', 'success', 0, base + 21_000_000)

    const found = estimate
      .loadVariantEstimates(['project-b'])
      .get(estimate.estimateKey('project-b', 'dirtySlots'))
    // 脏数据如果占了名额，这里只会剩 8 条（1000..8000，中位数 4500）
    expect(found).toEqual({ medianMs: 5_500, samples: 10 })
  })

  it('项目列表为空时直接返回空表，不查库', () => {
    expect(estimate.loadVariantEstimates([]).size).toBe(0)
  })
})

/**
 * 估值要真的落到队列 DTO 上：中位数算对了但没接进 `toQueueItemDto`，
 * 界面上依然什么都不会显示 —— 这条用例专门盯这个接缝。
 */
describe('队列 DTO 上的 estimatedMs', () => {
  it('有成功历史的变体带中位数，没有历史的变体是 null', async () => {
    const items = await import('./items')

    // 先建项目：build_runs 通过 queue_items 关联项目，队列项对项目有外键
    dbModule.db
      .insert(schema.projects)
      .values([{ id: 'project-c', name: '项目 C', path: join(workspace, 'c'), selectedVariants: '[]' }])
      .run()

    addRun('project-c', 'freeDebug', 'success', 100_000, 40_000_000)
    addRun('project-c', 'freeDebug', 'success', 200_000, 41_000_000)

    // 一条正在跑 freeDebug（有历史）与 paidRelease（没历史）
    dbModule.db
      .insert(schema.queueItems)
      .values({
        id: 'item-dto',
        projectId: 'project-c',
        state: 'running',
        variants: JSON.stringify(['freeDebug', 'paidRelease']),
        enqueuedAt: new Date(42_000_000)
      })
      .run()
    dbModule.db
      .insert(schema.buildRuns)
      .values([
        {
          id: 'run-dto-1',
          queueItemId: 'item-dto',
          variant: 'freeDebug',
          state: 'running',
          startedAt: new Date(42_000_000)
        },
        {
          id: 'run-dto-2',
          queueItemId: 'item-dto',
          variant: 'paidRelease',
          state: 'running',
          startedAt: new Date(42_000_000)
        }
      ])
      .run()

    const item = items.listItems().find((row) => row.id === 'item-dto')
    expect(item).toBeDefined()
    const byVariant = new Map(item?.runs.map((run) => [run.variant, run.estimatedMs]))
    expect(byVariant.get('freeDebug')).toBe(150_000)
    expect(byVariant.get('paidRelease')).toBeNull()
  })

  it('不传估值表时（广播路径）自己按这一行的项目现查', async () => {
    const items = await import('./items')
    const row = items.findItemRow('item-dto')
    if (row === null) {
      throw new Error('造数没写上 item-dto')
    }
    const dto = items.toQueueItemDto(row)
    const byVariant = new Map(dto.runs.map((run) => [run.variant, run.estimatedMs]))
    expect(byVariant.get('freeDebug')).toBe(150_000)
    expect(byVariant.get('paidRelease')).toBeNull()
  })
})
