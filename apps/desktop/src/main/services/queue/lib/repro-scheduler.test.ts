import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'

/**
 * 临时复现（用完即删）：走**调度器**而不是直接调 executeQueueItem。
 * 目的：把每次 queue:state 推送里「项状态 / 变体状态」逐个打出来，
 * 看列表为什么在构建期间显示「排队中」。
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
let scheduler: typeof import('./scheduler')
let channels: typeof import('@shared/constants/channels')
let queueStateChannel: string

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-repro-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace
  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  schema = await import('../../../db/schema')
  items = await import('./items')
  scheduler = await import('./scheduler')
  channels = await import('@shared/constants/channels')
  queueStateChannel = channels.IPC_CHANNELS.QUEUE.STATE
})

afterAll(() => {
  try { rmSync(workspace, { recursive: true, force: true }) } catch { /* 连接还开着，交给系统 */ }
})

function seedProject(id: string, name: string): string {
  const dir = join(workspace, id)
  mkdirSync(join(dir, 'app'), { recursive: true })
  dbModule.db.insert(schema.projects).values({ id, name, path: dir, selectedVariants: JSON.stringify(['demoDebug']) }).run()
  writeFileSync(join(dir, 'settings.gradle'), "rootProject.name = 'sample'\n", 'utf8')
  writeFileSync(join(dir, 'app', 'build.gradle'), ['android {', '  flavorDimensions "channel"', '  productFlavors {', '    demo { dimension "channel" }', '  }', '}', ''].join('\n'), 'utf8')
  // 假 gradlew：立刻成功返回，让整条链跑完但不真起 Gradle
  writeFileSync(join(dir, 'gradlew'), '@echo off\r\nexit /b 0\r\n', 'utf8')
  return dir
}

describe('复现：调度器路径下的状态推送', () => {
  it('两个队列项，打印每次 queue:state 里的项状态与变体状态', async () => {
    seedProject('repro-a', '复现A')
    seedProject('repro-b', '复现B')
    const a = items.createItem('repro-a', ['demoDebug'])
    const b = items.createItem('repro-b', ['demoDebug'])
    hoisted.calls.length = 0

    scheduler.setConcurrency(1)
    scheduler.tick()
    // 等两个项都跑完
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const done = [a.id, b.id].every((id) => {
        const row = items.findItemRow(id)
        return row !== null && row.state !== 'pending' && row.state !== 'running'
      })
      if (done) break
    }

    const rows = hoisted.calls
      .filter((c) => c.channel === queueStateChannel)
      .map((c) => {
        const p = c.payload as { item?: { id?: string; state?: string; startedAt?: number | null; runs?: Array<{ state?: string }> } }
        const id = p.item?.id === a.id ? 'A' : p.item?.id === b.id ? 'B' : '?'
        const runs = (p.item?.runs ?? []).map((r) => r.state).join(',')
        return `项${id} state=${p.item?.state} startedAt=${p.item?.startedAt === null ? 'null' : '有值'} runs=[${runs}]`
      })
    console.log('\n=== queue:state 推送序列（共 ' + rows.length + ' 次）===')
    for (const r of rows) console.log('  ' + r)
    console.log('=== 结束 ===\n')
  }, 30000)
})