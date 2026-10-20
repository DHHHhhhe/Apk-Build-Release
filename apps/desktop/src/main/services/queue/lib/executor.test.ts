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
const hoisted = vi.hoisted(() => ({
  calls: [] as Array<{ channel: string; payload: unknown }>,
  /**
   * 伪造的 Gradle 执行：默认成功且不产生产物。
   * 单独给 chunks 时，会按顺序喂给 onChunk —— 用来验证「输出 → 进度解析 → 推送」这条链路。
   */
  gradle: { chunks: [] as string[], exitCode: 0 }
}))

vi.mock('../../../lib/broadcast', () => ({
  broadcast: (channel: string, payload: unknown): void => {
    hoisted.calls.push({ channel, payload })
  }
}))

/**
 * 不跑真 Gradle：这条测试关心的是状态与进度广播，不是 Gradle 本身。
 * 另外真跑一个假 gradlew 时退出码取决于 cmd，拿它当「成功」的判据不可靠。
 */
vi.mock('../../build/lib/spawn-gradle', () => ({
  variantTaskPath: (modulePath: string | null, variant: string) =>
    (modulePath ?? '') + ':assemble' + variant,
  runGradleTask: async (options: {
    logPath: string
    onChunk?: (chunk: string) => void
  }): Promise<{
    exitCode: number
    timedOut: boolean
    durationMs: number
    logPath: string
    outputTail: string
  }> => {
    // 进度有 200ms 节流：喂 chunk 之前先让出窗口，否则解析结果会被吞掉
    if (hoisted.gradle.chunks.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 260))
    }
    for (const chunk of hoisted.gradle.chunks) {
      options.onChunk?.(chunk)
    }
    return {
      exitCode: hoisted.gradle.exitCode,
      timedOut: false,
      durationMs: 1,
      logPath: options.logPath,
      outputTail: ''
    }
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
  // 每条用例自己决定要不要喂 Gradle 输出，避免上一条的 chunk 漏到下一条
  hoisted.gradle.chunks = []
  hoisted.gradle.exitCode = 0
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

  /**
   * 这条守的是「快照里的内容对不对」，而不只是「推了没有」。
   *
   * 曾经的样子：变体开始时只把 'running' 当参数广播给 BUILD.STATE（详情读参数，显示「构建中」），
   * 而队列列表订阅的 QUEUE.STATE 快照是从库里读的 —— 库里那行还没写 running，
   * 于是列表一直显示「排队中」，要等第一个变体出结果才追上。
   *
   * 所以断言落在快照的 runs 上：构建期间必须出现过 running。
   * 不写库的话，快照里永远只有 pending，这条会红。
   */
  it('变体开始构建时，queue:state 快照里的该变体已经是 running', async () => {
    const dir = join(workspace, 'snapshot-variant-state')
    mkdirSync(dir, { recursive: true })
    seedProject(
      'proj-snapshot',
      '快照示例',
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
    const item = items.createItem('proj-snapshot', ['demoDebug', 'paidDebug'])
    hoisted.calls.length = 0

    await executor.executeQueueItem(item.id)

    const runStates = hoisted.calls
      .filter((call) => call.channel === queueStateChannel)
      .map((call) => call.payload as { item?: { runs?: Array<{ state?: string }> } })
      .flatMap((payload) => (payload.item?.runs ?? []).map((run) => String(run.state)))

    expect(runStates).toContain('running')
  })

  /**
   * 进度事件是这一轮新加的「可观察进度」的唯一入口。
   *
   * 断言落在三件事上：`starting` 必须在 Gradle 启动前就发出（否则点下构建会空白几秒）、
   * 变体结束后必须走到 `archiving`（这是日志里完全没有的一段），以及事件带着 runId/variant
   * 能对回具体的变体行。
   */
  it('每个变体都推构建进度：starting → archiving → done', async () => {
    const dir = join(workspace, 'progress-variant')
    mkdirSync(dir, { recursive: true })
    seedProject(
      'proj-progress',
      '进度示例',
      dir,
      ['android {', '  flavorDimensions "channel"', '  productFlavors {', '    demo { dimension "channel" }', '  }', '}', ''].join('\n')
    )
    const item = items.createItem('proj-progress', ['demoDebug'])
    // 一段真实形状的输出：跳过行、实际执行行各一
    hoisted.gradle.chunks = ['> Task :app:preBuild UP-TO-DATE\n', '> Task :app:compileDemoDebugJavaWithJavac\n']
    hoisted.calls.length = 0

    await executor.executeQueueItem(item.id)

    const phases = hoisted.calls
      .filter((call) => call.channel === channels.IPC_CHANNELS.BUILD.PROGRESS)
      .map((call) => call.payload as { phase?: string; task?: string | null; runId?: string; variant?: string })

    expect(phases.length).toBeGreaterThan(0)
    expect(phases[0]?.phase).toBe('starting')
    // Gradle 输出真被解析了：跳过的那行只计数，执行的那行把阶段推到 executing 并带上任务名
    const executing = phases.find((event) => event.phase === 'executing')
    expect(executing?.task).toBe('compileDemoDebugJavaWithJavac')
    expect(phases.map((event) => event.phase)).toContain('archiving')
    expect(phases.map((event) => event.phase)).toContain('done')
    // 每条都要带 runId 与变体名：界面靠这两个把进度对到队列项里的那一行
    expect(phases.every((event) => typeof event.runId === 'string' && event.variant === 'demoDebug')).toBe(true)

    /**
     * 阶段序列必须落库：历史记录也靠它「只看关键节点」。
     * 不落库的话，跑完之后只有日志正文可压缩，而日志窗口装不下几千行。
     */
    const runId = phases[0]?.runId
    const runRow = dbModule.db
      .select()
      .from(schema.buildRuns)
      .all()
      .find((row) => row.id === runId)
    expect(typeof runRow?.stagePoints).toBe('string')
    const stored = JSON.parse(runRow?.stagePoints ?? '[]') as Array<{ phase?: string; task?: string | null }>
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.some((point) => point.phase === 'executing')).toBe(true)
    // Gradle 之外的两段也在序列里：它们本来只存在于进度事件，日志里看不到
    expect(stored.some((point) => point.phase === 'archiving')).toBe(true)
    expect(stored[stored.length - 1]?.phase).toBe('done')
  })
})