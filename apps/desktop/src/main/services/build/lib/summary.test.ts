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
