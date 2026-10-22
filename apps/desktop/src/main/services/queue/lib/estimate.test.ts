import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let schema: typeof import('../../../db/schema')
let estimate: typeof import('./estimate')

let seq = 0

/** 造一条历史耗时样本（只写统计表，不碰队列与构建记录） */
function addSample(projectId: string, variant: string, durationMs: number, endedAt: number): void {
  seq += 1
  dbModule.db
    .insert(schema.variantStats)
    .values({
      id: 'sample-' + seq,
      projectId,
      variant,
      durationMs,
      endedAt: new Date(endedAt),
      sourceRunId: 'seed-run-' + seq
    })
    .run()
}

/** 造一条队列项 + 一条构建记录：DTO 上的 runs 来自这里 */
function addRun(
  projectId: string,
  variant: string,
  state: 'success' | 'failed' | 'canceled' | 'running',
  finishedBase: number
): void {
  seq += 1
  const itemId = 'item-' + seq
  const runId = 'run-' + seq
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
      startedAt: new Date(finishedBase - 180_000),
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
  it('同项目同变体取最近 10 条的中位数', () => {
    const base = 1_000_000
    addSample('project-a', 'demoDebug', 100_000, base + 1_000_000)
    addSample('project-a', 'demoDebug', 200_000, base + 2_000_000)
    addSample('project-a', 'demoDebug', 400_000, base + 3_000_000)

    const found = estimate
      .loadVariantEstimates(['project-a'])
      .get(estimate.estimateKey('project-a', 'demoDebug'))
    expect(found).toEqual({ medianMs: 200_000, samples: 3 })
  })

  it('同名的变体在不同项目里互不影响', () => {
    addSample('project-b', 'demoDebug', 60_000, 10_000_000)

    const table = estimate.loadVariantEstimates(['project-a', 'project-b'])
    expect(table.get(estimate.estimateKey('project-a', 'demoDebug'))?.medianMs).toBe(200_000)
    expect(table.get(estimate.estimateKey('project-b', 'demoDebug'))?.medianMs).toBe(60_000)
  })

  it('样本超过上限时只取最近 10 次', () => {
    const base = 20_000_000
    for (let index = 0; index < 12; index += 1) {
      addSample('project-b', 'limitedVariant', (index + 1) * 1000, base + (index + 1) * 1_000_000)
    }

    const found = estimate
      .loadVariantEstimates(['project-b'])
      .get(estimate.estimateKey('project-b', 'limitedVariant'))
    // 最近 10 次是 3000..12000，中位数 = (7000 + 8000) / 2
    expect(found).toEqual({ medianMs: 7_500, samples: 10 })
  })

  it('脏耗时不算进「最近 10 次」的名额', () => {
    const base = 50_000_000
    for (let index = 0; index < 10; index += 1) {
      addSample('project-b', 'dirtySlots', (index + 1) * 1000, base + (index + 1) * 1_000_000)
    }
    // 两条脏数据比干净样本都新：若它们占名额，只会剩 8 条（1000..8000，中位数 4500）
    addSample('project-b', 'dirtySlots', 0, base + 20_000_000)
    addSample('project-b', 'dirtySlots', -10, base + 21_000_000)

    const found = estimate
      .loadVariantEstimates(['project-b'])
      .get(estimate.estimateKey('project-b', 'dirtySlots'))
    expect(found).toEqual({ medianMs: 5_500, samples: 10 })
  })

  it('清空队列记录之后估值仍在（统计表不跟着构建记录删）', async () => {
    const items = await import('./items')
    addSample('project-b', 'survivesClear', 90_000, 60_000_000)
    addRun('project-b', 'survivesClear', 'success', 60_001_000)

    items.clearItems('all')

    const remainingItems = dbModule.db.select().from(schema.queueItems).all()
    const remainingRuns = dbModule.db.select().from(schema.buildRuns).all()
    expect(remainingItems).toHaveLength(0)
    expect(remainingRuns).toHaveLength(0)

    const found = estimate
      .loadVariantEstimates(['project-b'])
      .get(estimate.estimateKey('project-b', 'survivesClear'))
    expect(found).toEqual({ medianMs: 90_000, samples: 1 })
  })

  it('项目列表为空时直接返回空表，不查库', () => {
    expect(estimate.loadVariantEstimates([]).size).toBe(0)
  })
})

describe('recordVariantDuration', () => {
  it('写进去的耗时能被读到', () => {
    estimate.recordVariantDuration({
      projectId: 'project-a',
      variant: 'recorded',
      durationMs: 123_000,
      endedAt: new Date(70_000_000),
      sourceRunId: 'record-run-1'
    })

    const found = estimate
      .loadVariantEstimates(['project-a'])
      .get(estimate.estimateKey('project-a', 'recorded'))
    expect(found).toEqual({ medianMs: 123_000, samples: 1 })
  })

  it('同一次构建重复写入不会翻倍（sourceRunId 去重）', () => {
    estimate.recordVariantDuration({
      projectId: 'project-a',
      variant: 'recorded',
      durationMs: 123_000,
      endedAt: new Date(70_000_000),
      sourceRunId: 'record-run-1'
    })
    const rows = dbModule.db.select().from(schema.variantStats).all()
    expect(rows.filter((row) => row.variant === 'recorded')).toHaveLength(1)
  })

  it('非正耗时直接丢弃，不落库', () => {
    estimate.recordVariantDuration({
      projectId: 'project-a',
      variant: 'recorded',
      durationMs: 0,
      endedAt: new Date(70_000_000),
      sourceRunId: 'record-run-zero'
    })
    const rows = dbModule.db.select().from(schema.variantStats).all()
    expect(rows.filter((row) => row.sourceRunId === 'record-run-zero')).toHaveLength(0)
  })

  it('只保留最近 N 条样本，不让表无限长', () => {
    const keep = dbModule.VARIANT_STATS_KEEP
    for (let index = 0; index < keep + 5; index += 1) {
      estimate.recordVariantDuration({
        projectId: 'project-a',
        variant: 'pruned',
        durationMs: 1000 + index,
        endedAt: new Date(80_000_000 + index * 1000),
        sourceRunId: 'prune-run-' + index
      })
    }

    const rows = dbModule.db
      .select()
      .from(schema.variantStats)
      .all()
      .filter((row) => row.variant === 'pruned')
    expect(rows).toHaveLength(keep)
    // 留下的是最新的那几条：最早的两条（1000、1001）已经被裁掉
    const keptDurations = rows.map((row) => row.durationMs).sort((left, right) => left - right)
    expect(keptDurations[0]).toBe(1005)
  })
})

/**
 * 估值要真的落到队列 DTO 上：中位数算对了但没接进 `toQueueItemDto`，
 * 界面上依然什么都不会显示 —— 这两条用例专门盯这个接缝。
 */
describe('队列 DTO 上的 estimatedMs', () => {
  it('有历史样本的变体带中位数，没有的变体是 null', async () => {
    const items = await import('./items')

    addSample('project-a', 'dtoDebug', 100_000, 90_000_000)
    addSample('project-a', 'dtoDebug', 200_000, 91_000_000)

    // 一条队列项里两个正在跑的变体：dtoDebug 有历史、dtoOther 没有
    dbModule.db
      .insert(schema.queueItems)
      .values({
        id: 'item-dto',
        projectId: 'project-a',
        state: 'running',
        variants: JSON.stringify(['dtoDebug', 'dtoOther']),
        enqueuedAt: new Date(92_000_000)
      })
      .run()
    dbModule.db
      .insert(schema.buildRuns)
      .values([
        {
          id: 'run-dto-1',
          queueItemId: 'item-dto',
          variant: 'dtoDebug',
          state: 'running',
          startedAt: new Date(92_000_000)
        },
        {
          id: 'run-dto-2',
          queueItemId: 'item-dto',
          variant: 'dtoOther',
          state: 'running',
          startedAt: new Date(92_000_000)
        }
      ])
      .run()

    const item = items.listItems().find((row) => row.id === 'item-dto')
    expect(item).toBeDefined()
    const byVariant = new Map(item?.runs.map((run) => [run.variant, run.estimatedMs]))
    expect(byVariant.get('dtoDebug')).toBe(150_000)
    expect(byVariant.get('dtoOther')).toBeNull()
  })

  it('不传估值表时（广播路径）自己按这一行的项目现查', async () => {
    const items = await import('./items')
    const row = items.findItemRow('item-dto')
    if (row === null) {
      throw new Error('造数没写上 item-dto')
    }
    const dto = items.toQueueItemDto(row)
    const byVariant = new Map(dto.runs.map((run) => [run.variant, run.estimatedMs]))
    expect(byVariant.get('dtoDebug')).toBe(150_000)
    expect(byVariant.get('dtoOther')).toBeNull()
  })
})
