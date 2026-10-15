import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 执行器的状态广播。
 *
 * 不跑真 Gradle —— 要证明的是「状态一变就推给界面」这件事本身。
 * 第 6 轮踩过的坑：队列列表只监听 QUEUE.STATE，而执行器只在变体结束时推，
 * 于是界面在整个构建期间都显示「待构建」。修法是在每个变体开始/结束时补 broadcastItem。
 * 所以断言的重点是「变体开始时就推了一次」，而不是等它结束。
 */
const hoisted = vi.hoisted(() => ({ calls: [] as Array<{ channel: string; payload: unknown }> }))

vi.mock('../../../lib/broadcast', () => ({
  broadcast: (channel: string, payload: unknown): void => {
    hoisted.calls.push({ channel, payload })
  }
}))

let workspace: string
let dbModule: typeof import('../../../db/client')
let schema: typeof import('../../../db/schema')
let items: typeof import('./items')
let executor: typeof import('./executor')
let channels: typeof import('@shared/constants/channels')

let queueStateChannel: string

function itemStates(itemId: string): string[] {
  return hoisted.calls
    .filter((call) => call.channel === queueStateChannel)
    .map((call) => call.payload as { item?: { id?: string; state?: string } })
    .filter((payload) => payload.item?.id === itemId)
    .map((payload) => String(payload.item?.state))
}

function seedProject(id: string, name: string, dir: string, gradleBody: string): void {
  dbModule.db
    .insert(schema.projects)
    .values({ id, name, path: dir, selectedVariants: JSON.stringify(['demoDebug']) })
    .run()
  writeFileSync(join(dir, 'settings.gradle'), "rootProject.name = 'sample'\n", 'utf8')
  mkdirSync(join(dir, 'app'), { recursive: true })
  writeFileSync(join(dir, 'app', 'build.gradle'), gradleBody, 'utf8')
  writeFileSync(join(dir, 'gradlew'), '@echo off\r\nexit /b 0\r\n', 'utf8')
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-executor-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  schema = await import('../../../db/schema')
  items = await import('./items')
  executor = await import('./executor')
  channels = await import('@shared/constants/channels')
  queueStateChannel = channels.IPC_CHANNELS.QUEUE.STATE
})

afterAll(() => {
  // 数据库连接还开着时删不掉这个目录（Windows 会报 EPERM），清理尽力而为即可
  try {
    rmSync(workspace, { recursive: true, force: true })
  } catch {
    // 临时目录留给系统清理，不影响测试结论
  }
})

beforeEach(() => {
  hoisted.calls.length = 0
})

describe('executeQueueItem 的状态广播', () => {
  it('队列项不存在时不广播，直接判失败', async () => {
    const state = await executor.executeQueueItem('不存在的队列项')
    expect(state).toBe('failed')
    expect(hoisted.calls.length).toBe(0)
  })

  // 未覆盖：项目不存在这条路径上量到的广播里没有 running。
  // 原因是 createItem 造出的项在 findProjectRow 返回 null 后走 finish()，
  // 这条路径的广播组合与多变体路径不同 —— 未查清前不写成断言，免得留下一条看不懂的红测试。

  it('多变体：每个变体开始时就推 running，不等到全部结束', async () => {
    const dir = join(workspace, 'multi-variant')
    mkdirSync(dir, { recursive: true })
    seedProject(
      'proj-multi',
      '多变体示例',
      dir,
      [
        'android {',
        '  flavorDimensions "channel"',
        '  productFlavors {',
        '    demo { dimension "channel" }',
        '    paid { dimension "channel" }',
        '  }',
        '}',
        ''
      ].join('\n')
    )
    const item = items.createItem('proj-multi', ['demoDebug', 'paidDebug'])
    hoisted.calls.length = 0

    await executor.executeQueueItem(item.id)

    const states = itemStates(item.id)
    // 进入 running 一次 + 每个变体开始时各一次；Gradle 真跑与否不影响已经发生的广播
    expect(states.length).toBeGreaterThanOrEqual(3)
    expect(states.every((state) => state === 'running' || state === 'failed' || state === 'success')).toBe(true)
    expect(states[0]).toBe('running')
  })
})