import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let summaryModule: typeof import('./summary')

const apkPathOne = () => join(workspace, 'out', 'project-a', 'sample_v1.0.0_release.apk')
const apkPathGone = () => join(workspace, 'out', 'project-b', 'missing.apk')

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-summary-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  summaryModule = await import('./summary')

  const schema = await import('../../../db/schema')
  const { db } = dbModule

  db.insert(schema.projects)
    .values([
      { id: 'p-a', name: '项目 A', path: join(workspace, 'a') },
      { id: 'p-b', name: '项目 B', path: join(workspace, 'b') }
    ])
    .run()

  // 第一批：A 成功（产物在）、B 失败
  db.insert(schema.queueItems)
    .values([
      { id: 'q-old-a', projectId: 'p-a', state: 'success', variants: '[]', enqueuedAt: new Date(1000) },
      { id: 'q-old-b', projectId: 'p-b', state: 'failed', variants: '[]', enqueuedAt: new Date(1000) }
    ])
    .run()

  mkdirSync(join(workspace, 'out', 'project-a'), { recursive: true })
  writeFileSync(apkPathOne(), 'x'.repeat(2048), 'utf8')

  db.insert(schema.buildRuns)
    .values([
      {
        id: 'r-old-a',
        queueItemId: 'q-old-a',
        variant: 'freeRelease',
        state: 'success',
        exitCode: 0,
        apkPath: apkPathOne(),
        apkName: 'sample_v1.0.0_release.apk',
        signed: false,
        startedAt: new Date(10_000),
        finishedAt: new Date(13_000)
      },
      {
        id: 'r-old-b',
        queueItemId: 'q-old-b',
        variant: 'demoRelease',
        state: 'failed',
        exitCode: 1,
        failureHint: '缺少 Android SDK 组件',
        startedAt: new Date(20_000),
        finishedAt: new Date(22_000)
      }
    ])
    .run()

  // 第二批（更晚）：A 成功，但产物已被移走
  db.insert(schema.queueItems)
    .values({ id: 'q-new-a', projectId: 'p-a', state: 'success', variants: '[]', enqueuedAt: new Date(30_000) })
    .run()
  db.insert(schema.buildRuns)
    .values([
      {
        id: 'r-new-a',
        queueItemId: 'q-new-a',
        variant: 'freeRelease',
        state: 'success',
        exitCode: 0,
        apkPath: apkPathGone(),
        apkName: 'missing.apk',
        signed: true,
        startedAt: new Date(30_000),
        finishedAt: new Date(35_000)
      },
      {
        id: 'r-new-a2',
        queueItemId: 'q-new-a',
        variant: 'demoRelease',
        state: 'canceled',
        startedAt: new Date(36_000),
        finishedAt: new Date(36_500)
      }
    ])
    .run()
})

afterAll(() => {
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('结果汇总', () => {
  it('最近一批只汇总最后一条队列项', () => {
    const summary = summaryModule.buildSummary({ scope: 'latest' })
    expect(summary.totals.projects).toBe(1)
    expect(summary.totals.variants).toBe(2)
    expect(summary.totals.success).toBe(1)
    expect(summary.totals.canceled).toBe(1)
    expect(summary.groups[0]?.projectName).toBe('项目 A')
    // 30s -> 35s 与 36s -> 36.5s
    expect(summary.totals.durationMs).toBe(5500)
  })

  it('全部记录跨项目汇总，并把失败原因带出来', () => {
    const summary = summaryModule.buildSummary({ scope: 'all' })
    expect(summary.totals.projects).toBe(2)
    expect(summary.totals.variants).toBe(4)
    expect(summary.totals.success).toBe(2)
    expect(summary.totals.failed).toBe(1)
    expect(summary.totals.canceled).toBe(1)
    const failed = summary.groups
      .flatMap((group) => group.artifacts)
      .find((artifact) => artifact.state === 'failed')
    expect(failed?.failureHint).toContain('SDK')
  })

  it('产物大小按磁盘真实文件算，文件没了要标出来', () => {
    const summary = summaryModule.buildSummary({ scope: 'all' })
    const artifacts = summary.groups.flatMap((group) => group.artifacts)
    const existing = artifacts.find((artifact) => artifact.apkName === 'sample_v1.0.0_release.apk')
    const gone = artifacts.find((artifact) => artifact.apkName === 'missing.apk')

    expect(existing?.apkBytes).toBe(2048)
    expect(existing?.apkMissing).toBe(false)
    expect(summary.totals.apkBytes).toBe(2048)
    expect(gone?.apkMissing).toBe(true)
    expect(gone?.apkBytes).toBe(0)
  })

  it('未签名产物单独计数', () => {
    const summary = summaryModule.buildSummary({ scope: 'all' })
    // sample_v1.0.0_release.apk 记为未签名，missing.apk 记为已签名
    expect(summary.totals.unsignedCount).toBe(1)
    expect(summary.totals.apkCount).toBe(2)
  })
})

/**
 * 批次语义：一次「构建勾选项」入队会为每个项目建一条队列项，它们共用一个 batchId。
 * 「最近一批」要覆盖这一次的全部项目，而不是最后跑完的那一条。
 *
 * 这个 describe 放最后：它会插入更晚的数据，跑在它前面的用例不能受影响。
 */
describe('最近一批按批次汇总', () => {
  beforeAll(async () => {
    const schema = await import('../../../db/schema')
    const { db } = dbModule

    db.insert(schema.queueItems)
      .values([
        {
          id: 'q-batch-a',
          projectId: 'p-a',
          state: 'success',
          variants: '[]',
          batchId: 'batch-1',
          enqueuedAt: new Date(50_000)
        },
        {
          id: 'q-batch-b',
          projectId: 'p-b',
          state: 'success',
          variants: '[]',
          batchId: 'batch-1',
          enqueuedAt: new Date(50_000)
        }
      ])
      .run()

    db.insert(schema.buildRuns)
      .values([
        {
          id: 'r-batch-a',
          queueItemId: 'q-batch-a',
          variant: 'freeRelease',
          state: 'success',
          exitCode: 0,
          startedAt: new Date(50_000),
          finishedAt: new Date(51_000)
        },
        {
          id: 'r-batch-b',
          queueItemId: 'q-batch-b',
          variant: 'demoRelease',
          state: 'success',
          exitCode: 0,
          startedAt: new Date(50_100),
          finishedAt: new Date(51_100)
        }
      ])
      .run()
  })

  it('同一次入队的多个项目一起汇总 —— 以前只显示最后一条队列项', () => {
    const summary = summaryModule.buildSummary({ scope: 'latest' })
    expect(summary.totals.projects).toBe(2)
    expect(summary.totals.variants).toBe(2)
    expect(summary.groups.map((group) => group.projectName).sort()).toEqual(['项目 A', '项目 B'])
  })

  it('老数据没有批次标识时，退回「只看它自己这一条」', async () => {
    const schema = await import('../../../db/schema')
    const { db } = dbModule
    // 更晚的一条，且没有 batchId（模拟加这一列之前入的队）
    db.insert(schema.queueItems)
      .values({
        id: 'q-legacy',
        projectId: 'p-b',
        state: 'success',
        variants: '[]',
        batchId: null,
        enqueuedAt: new Date(90_000)
      })
      .run()
    db.insert(schema.buildRuns)
      .values({
        id: 'r-legacy',
        queueItemId: 'q-legacy',
        variant: 'demoRelease',
        state: 'success',
        exitCode: 0,
        startedAt: new Date(90_000),
        finishedAt: new Date(91_000)
      })
      .run()

    const summary = summaryModule.buildSummary({ scope: 'latest' })
    expect(summary.totals.projects).toBe(1)
    expect(summary.totals.variants).toBe(1)
  })
})
