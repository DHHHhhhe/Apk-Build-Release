import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 老库升级：`variant_stats` 是 0.7.2 之后才有的表。
 *
 * 升级前那个用户的成功耗时只存在于 `build_runs` 里，而 build_runs 会被「清空队列记录」
 * 级联删掉 —— 所以升级时要先把已有的成功耗时搬进统计表，否则一装上新版就等于从零开始攒，
 * 用户会以为进度条坏了。
 *
 * 搬的动作必须**幂等**：重复启动不能翻倍，也不能在用户清空记录后又把旧数据搬回来。
 */
let workspace: string
let client: typeof import('./client')

const PROJECT_ID = 'p-legacy'

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-variant-stats-'))
  const dbPath = join(workspace, 'legacy.db')

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
    CREATE TABLE queue_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending',
      variants TEXT NOT NULL DEFAULT '[]',
      attempt INTEGER NOT NULL DEFAULT 1,
      enqueued_at INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE build_runs (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
      variant TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER
    );
  `)
  legacy
    .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
    .run(PROJECT_ID, '老项目', join(workspace, 'legacy-project'))
  legacy
    .prepare('INSERT INTO queue_items (id, project_id, state, variants) VALUES (?, ?, ?, ?)')
    .run('qi-1', PROJECT_ID, 'success', '["demoRelease"]')
  // 一条成功（70s）、一条失败（3s，不该被搬）、一条取消（1s，不该被搬）
  legacy
    .prepare(
      'INSERT INTO build_runs (id, queue_item_id, variant, state, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('br-ok', 'qi-1', 'demoRelease', 'success', 1_000_000, 1_070_000)
  legacy
    .prepare(
      'INSERT INTO build_runs (id, queue_item_id, variant, state, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('br-fail', 'qi-1', 'demoRelease', 'failed', 2_000_000, 2_003_000)
  legacy
    .prepare(
      'INSERT INTO build_runs (id, queue_item_id, variant, state, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run('br-cancel', 'qi-1', 'demoRelease', 'canceled', 3_000_000, 3_001_000)
  legacy.close()

  process.env.APK_BUILD_DB_PATH = dbPath
  process.env.APK_BUILD_USER_DATA = workspace
  client = await import('./client')
})

afterAll(() => {
  try {
    client?.sqlite.close()
  } catch {
    // 已经关过就算了
  }
  rmSync(workspace, { recursive: true, force: true })
})

function statRows(): Array<{ project_id: string; variant: string; duration_ms: number }> {
  return client.sqlite
    .prepare('SELECT project_id, variant, duration_ms FROM variant_stats ORDER BY ended_at')
    .all() as Array<{ project_id: string; variant: string; duration_ms: number }>
}

describe('variant_stats 建表与老数据迁移', () => {
  it('升级时把历史成功耗时搬进统计表，失败与取消不搬', () => {
    client.ensureSchema()

    const rows = statRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.project_id).toBe(PROJECT_ID)
    expect(rows[0]?.variant).toBe('demoRelease')
    expect(rows[0]?.duration_ms).toBe(70_000)
  })

  it('重复执行 ensureSchema 不会翻倍', () => {
    client.ensureSchema()
    client.ensureSchema()
    expect(statRows()).toHaveLength(1)
  })

  it('用户清空构建记录后再启动，已有样本既不被删也不重复搬', () => {
    client.sqlite.exec('DELETE FROM build_runs')
    client.ensureSchema()

    const rows = statRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.duration_ms).toBe(70_000)
  })
})
