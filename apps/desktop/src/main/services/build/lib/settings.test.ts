import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let settings: typeof import('./settings')

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-settings-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  settings = await import('./settings')
})

afterAll(() => {
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('显示变体构建进度条的偏好', () => {
  it('从没写过时按开启处理（功能默认可见）', () => {
    expect(settings.getShowVariantProgress()).toBe(true)
  })

  it('关掉后读回 false，再打开读回 true', () => {
    settings.setShowVariantProgress(false)
    expect(settings.getShowVariantProgress()).toBe(false)

    settings.setShowVariantProgress(true)
    expect(settings.getShowVariantProgress()).toBe(true)
  })

  it('存进去的值非法时按默认值处理，不让界面拿到脏数据', () => {
    dbModule.sqlite
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run(settings.SHOW_VARIANT_PROGRESS_KEY, 'not-a-boolean', 'not-a-boolean')
    expect(settings.getShowVariantProgress()).toBe(true)
  })
})
