import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NO_BUILDABLE_VARIANT_REASON } from '@shared/lib/variants'

let workspace: string
let dbModule: typeof import('../../../db/client')
let items: typeof import('../lib/items')
let scheduler: typeof import('../lib/scheduler')
let enqueue: typeof import('./enqueue')

const projectId = 'project-enqueue'
const projectId2 = 'project-enqueue-2'

/** 假执行器：不跑 Gradle，但要把项收尾，否则它会一直挂在 running 上 */
function fakeExecutor(delayMs: number): (itemId: string) => Promise<'success'> {
  return async (itemId: string) => {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    items.updateItem(itemId, { state: 'success', finishedAt: new Date() })
    return 'success'
  }
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-enqueue-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  items = await import('../lib/items')
  scheduler = await import('../lib/scheduler')
  enqueue = await import('./enqueue')

  const schema = await import('../../../db/schema')
  dbModule.db
    .insert(schema.projects)
    .values([
      {
        id: projectId,
        name: '有变体的项目',
        path: join(workspace, 'a'),
        selectedVariants: JSON.stringify(['freeDebug'])
      },
      {
        id: projectId2,
        name: '没勾变体的项目',
        path: join(workspace, 'b'),
        selectedVariants: '[]'
      }
    ])
    .run()

  dbModule.db
    .insert(schema.projectVariants)
    .values({ id: 'variant-1', projectId, name: 'freeDebug', flavor: 'free', buildType: 'debug', source: 'static' })
    .run()
})

afterAll(() => {
  scheduler.setExecutorForTest(null)
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('入队校验', () => {
  it('没勾变体的项目会被跳过并说明原因', () => {
    const result = enqueue.enqueueProjects({ targets: [{ projectId: projectId2, variants: [] }] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('没有勾选变体')
  })

  it('同一个项目重复入队会被拦住，不会跑两遍', async () => {
    scheduler.setExecutorForTest(fakeExecutor(80))
    scheduler.setConcurrency(1)

    const first = enqueue.enqueueProjects({ targets: [{ projectId, variants: ['freeDebug'] }] })
    expect(first.success).toBe(true)
    expect(first.items).toHaveLength(1)

    const second = enqueue.enqueueProjects({ targets: [{ projectId, variants: ['freeDebug'] }] })
    expect(second.success).toBe(false)
    expect(second.error).toContain('已经在队列里')

    await scheduler.waitForIdle(3000)
  })

  it('混合入队时，可入队的进去、其余的回报原因', async () => {
    scheduler.setExecutorForTest(fakeExecutor(10))
    const result = enqueue.enqueueProjects({
      targets: [
        { projectId, variants: ['freeDebug'] },
        { projectId: projectId2, variants: [] }
      ]
    })
    expect(result.success).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.error).toContain('没有勾选变体')
    await scheduler.waitForIdle(3000)
  })

  it('勾选里只有非 release 变体时不入队：出包只带 release', async () => {
    const schema = await import('../../../db/schema')
    dbModule.db
      .insert(schema.projects)
      .values({
        id: 'project-debug-only',
        name: '只勾了 debug 的项目',
        path: join(workspace, 'c'),
        selectedVariants: JSON.stringify(['demoDebug'])
      })
      .run()
    dbModule.db
      .insert(schema.projectVariants)
      .values([
        { id: 'v-rel', projectId: 'project-debug-only', name: 'demoRelease', flavor: 'demo', buildType: 'release', source: 'static' },
        { id: 'v-dbg', projectId: 'project-debug-only', name: 'demoDebug', flavor: 'demo', buildType: 'debug', source: 'static' }
      ])
      .run()

    const result = enqueue.enqueueProjects({
      targets: [{ projectId: 'project-debug-only', variants: ['demoDebug'] }]
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain(NO_BUILDABLE_VARIANT_REASON)
  })

  it('勾了 release 时才入队，且只带 release 变体', async () => {
    const schema = await import('../../../db/schema')
    dbModule.db
      .update(schema.projects)
      .set({ selectedVariants: JSON.stringify(['demoRelease', 'demoDebug']) })
      .where(eq(schema.projects.id, 'project-debug-only'))
      .run()

    scheduler.setExecutorForTest(fakeExecutor(10))
    const result = enqueue.enqueueProjects({
      targets: [{ projectId: 'project-debug-only', variants: ['demoRelease', 'demoDebug'] }]
    })
    expect(result.success).toBe(true)
    expect(result.items[0]?.variants).toEqual(['demoRelease'])
    await scheduler.waitForIdle(3000)
  })
})
