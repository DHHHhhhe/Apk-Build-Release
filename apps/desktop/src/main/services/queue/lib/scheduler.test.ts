import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let items: typeof import('../lib/items')
let scheduler: typeof import('../lib/scheduler')

let projectId: string
let projectId2: string

// 假的执行器：不跑 Gradle，只记录并发情况，由测试控制何时结束
let started: string[] = []
let resolvers: Array<() => void> = []
let inFlight = 0
let peak = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fakeExecutor(itemId: string): Promise<'success'> {
  started.push(itemId)
  inFlight += 1
  peak = Math.max(peak, inFlight)
  await new Promise<void>((resolve) => {
    resolvers.push(resolve)
  })
  inFlight -= 1
  items.updateItem(itemId, { state: 'success', finishedAt: new Date() })
  return 'success'
}

function releaseOne(): void {
  const next = resolvers.shift()
  next?.()
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-queue-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  items = await import('../lib/items')
  scheduler = await import('../lib/scheduler')

  const schema = await import('../../../db/schema')
  projectId = 'project-a'
  projectId2 = 'project-b'
  dbModule.db
    .insert(schema.projects)
    .values([
      { id: projectId, name: '项目 A', path: join(workspace, 'a'), selectedVariants: '[]' },
      { id: projectId2, name: '项目 B', path: join(workspace, 'b'), selectedVariants: '[]' }
    ])
    .run()
})

afterAll(async () => {
  scheduler.setExecutorForTest(null)
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

beforeEach(async () => {
  scheduler.clearQueue('all')
  started = []
  resolvers = []
  inFlight = 0
  peak = 0
  scheduler.setExecutorForTest(fakeExecutor)
})

describe('并发上限', () => {
  it('并发 1 时一次只跑一条，跑完才取下一个', async () => {
    scheduler.setConcurrency(1)
    scheduler.enqueueItem(projectId, ['freeDebug'])
    scheduler.enqueueItem(projectId2, ['freeDebug'])
    await delay(30)

    expect(started).toHaveLength(1)
    expect(scheduler.runningItemIds()).toHaveLength(1)

    releaseOne()
    await delay(30)
    expect(started).toHaveLength(2)
    expect(peak).toBe(1)

    releaseOne()
    await scheduler.waitForIdle(2000)
    expect(scheduler.runningItemIds()).toHaveLength(0)
  })

  it('并发调到 2 后两条同时跑', async () => {
    scheduler.setConcurrency(2)
    scheduler.enqueueItem(projectId, ['freeDebug'])
    scheduler.enqueueItem(projectId2, ['freeDebug'])
    await delay(30)

    expect(started).toHaveLength(2)
    expect(peak).toBe(2)

    releaseOne()
    releaseOne()
    await scheduler.waitForIdle(2000)
    expect(scheduler.runningItemIds()).toHaveLength(0)
  })

  it('并发上限被夹在 1..3', () => {
    expect(scheduler.setConcurrency(9)).toBe(3)
    expect(scheduler.setConcurrency(0)).toBe(1)
    expect(scheduler.setConcurrency(2)).toBe(2)
  })
})

describe('取消 / 重试 / 清空', () => {
  it('取消排队中的项直接置为 canceled，不会被执行', async () => {
    scheduler.setConcurrency(1)
    const first = scheduler.enqueueItem(projectId, ['freeDebug'])
    const second = scheduler.enqueueItem(projectId2, ['freeDebug'])
    await delay(30)

    const result = scheduler.cancelItem(second.id)
    expect(result.success).toBe(true)
    expect(items.findItemRow(second.id)?.state).toBe('canceled')

    releaseOne()
    await scheduler.waitForIdle(2000)
    expect(started).toEqual([first.id])
    expect(items.findItemRow(first.id)?.state).toBe('success')
  })

  it('已结束的项不能取消，但可以重试成新的一条', async () => {
    scheduler.setConcurrency(1)
    const item = scheduler.enqueueItem(projectId, ['freeDebug'])
    await delay(30)
    releaseOne()
    await scheduler.waitForIdle(2000)

    expect(scheduler.cancelItem(item.id).success).toBe(false)

    const retried = scheduler.retryItem(item.id)
    expect(retried.success).toBe(true)
    expect(retried.item?.attempt).toBe(2)
    expect(retried.item?.variants).toEqual(['freeDebug'])

    await delay(30)
    releaseOne()
    await scheduler.waitForIdle(2000)
  })

  it('还在队列里的项不能重试', async () => {
    scheduler.setConcurrency(1)
    const item = scheduler.enqueueItem(projectId, ['freeDebug'])
    await delay(30)
    expect(scheduler.retryItem(item.id).success).toBe(false)
    releaseOne()
    await scheduler.waitForIdle(2000)
  })

  it('清空已结束只删结束的，清空全部连排队的一起删', async () => {
    scheduler.setConcurrency(1)
    const first = scheduler.enqueueItem(projectId, ['freeDebug'])
    await delay(30)
    releaseOne()
    await scheduler.waitForIdle(2000)

    const pending = scheduler.enqueueItem(projectId2, ['freeDebug'])
    expect(items.listItems()).toHaveLength(2)

    expect(scheduler.clearQueue('finished')).toBe(1)
    expect(items.findItemRow(pending.id)?.state).toBe('pending')

    scheduler.setExecutorForTest(async () => {
      await delay(50)
      return 'success'
    })
    expect(scheduler.clearQueue('all')).toBeGreaterThanOrEqual(1)
    expect(items.listItems()).toHaveLength(0)
    expect(first.id).toBeTruthy()
  })

  it('全部取消会同时处理正在跑的和排队的', async () => {
    scheduler.setConcurrency(1)
    const running = scheduler.enqueueItem(projectId, ['freeDebug'])
    const waiting = scheduler.enqueueItem(projectId2, ['freeDebug'])
    await delay(30)

    expect(scheduler.runningItemIds()).toEqual([running.id])

    const canceled = scheduler.cancelAllItems()
    expect(canceled).toBe(2)
    // 排队中的直接置取消；正在跑的已收到取消请求，等执行器收尾
    expect(items.findItemRow(waiting.id)?.state).toBe('canceled')

    releaseOne()
    await scheduler.waitForIdle(2000)
  })
})

describe('异常退出收尾', () => {
  it('把残留的 running / pending 标成 failed 并写明原因', async () => {
    scheduler.setExecutorForTest(async () => {
      await delay(50)
      return 'success'
    })
    const running = items.createItem(projectId, ['freeDebug'])
    items.updateItem(running.id, { state: 'running', startedAt: new Date() })
    const pending = items.createItem(projectId2, ['freeDebug'])

    const recovered = scheduler.recoverStale()
    expect(recovered).toBe(2)
    expect(items.findItemRow(running.id)?.state).toBe('failed')
    expect(items.findItemRow(running.id)?.note).toContain('异常退出')
    expect(items.findItemRow(pending.id)?.state).toBe('failed')
  })
})
