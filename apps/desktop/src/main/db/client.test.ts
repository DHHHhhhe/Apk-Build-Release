import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 老库升级。
 *
 * 踩过的坑：`projects.alias` 与 `projects.sort_order` 是后加的两列，建表语句里有、
 * 但补列兜底漏了 —— `CREATE TABLE IF NOT EXISTS` 对已存在的表是空操作，
 * 于是新装的库正常、老库一查就报 `no such column: "alias"`。
 *
 * 这条测试造一个「只有旧列」的 projects 表，再跑 ensureSchema，断言两列被补上。
 */
let workspace: string
let client: typeof import('./client')

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-db-'))
  const dbPath = join(workspace, 'legacy.db')
  // 先造一个旧版表：没有 alias / sort_order
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      app_module TEXT,
      selected_variants TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `)
  legacy.close()
  process.env.APK_BUILD_DB_PATH = dbPath
  client = await import('./client')
})

afterAll(() => {
  try { rmSync(workspace, { recursive: true, force: true }) } catch { /* 连接还开着，交给系统 */ }
})

describe('ensureSchema 对老库补列', () => {
  it('老库缺 projects.alias 与 projects.sort_order 时会被补上', () => {
    client.ensureSchema()
    const columns = client.sqlite.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
    const names = columns.map((item) => item.name)
    expect(names).toContain('alias')
    expect(names).toContain('sort_order')
  })
})