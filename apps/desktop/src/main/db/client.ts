import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { join } from 'node:path'
import { logger as baseLogger } from '../services/logger'
import * as schema from './schema'

const logger = baseLogger.scope('db')

// 开发与生产用不同的库文件，避免调试数据污染真实数据（.trellis/spec/backend/environment.md）
// APK_BUILD_DB_PATH 供测试与排障时指定库文件位置
const isDev = !app.isPackaged
const dbFileName = isDev ? 'app-dev.db' : 'app.db'
const defaultDbPath = isDev ? join(process.cwd(), dbFileName) : join(app.getPath('userData'), dbFileName)
const dbPath = process.env.APK_BUILD_DB_PATH ?? defaultDbPath

export const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

/**
 * 建表。第一期还没有需要保留的迁移历史，所以用幂等建表而不是 drizzle-kit 迁移；
 * 等有真实用户数据要升级时再切到 drizzle-kit + migrate（schema.ts 已经是单一事实来源）。
 */
export function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      app_module TEXT,
      alias TEXT,
      sort_order INTEGER,
      selected_variants TEXT NOT NULL DEFAULT '[]',
      variants_source TEXT,
      variants_signature TEXT,
      variants_notes TEXT NOT NULL DEFAULT '[]',
      variants_resolved_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS projects_path_idx ON projects (path);

    CREATE TABLE IF NOT EXISTS project_variants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      flavor TEXT,
      build_type TEXT NOT NULL,
      source TEXT NOT NULL,
      resolved_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS project_variants_project_idx ON project_variants (project_id);

    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending',
      variants TEXT NOT NULL DEFAULT '[]',
      attempt INTEGER NOT NULL DEFAULT 1,
      enqueued_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      started_at INTEGER,
      finished_at INTEGER,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS queue_items_state_idx ON queue_items (state);

    CREATE TABLE IF NOT EXISTS build_runs (
      id TEXT PRIMARY KEY,
      queue_item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
      variant TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'running',
      exit_code INTEGER,
      log_path TEXT,
      apk_path TEXT,
      apk_name TEXT,
      application_id TEXT,
      version_name TEXT,
      version_code INTEGER,
      signed INTEGER,
      failure_kind TEXT,
      failure_hint TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS build_runs_item_idx ON build_runs (queue_item_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `)

  // 幂等补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加新字段
  ensureColumn('build_runs', 'failure_hint', 'TEXT')
  ensureColumn('queue_items', 'variants', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('queue_items', 'note', 'TEXT')

  logger.info('数据库就绪', { path: dbPath })
}

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((item) => item.name === column)) {
    return
  }
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  logger.info('已补上缺失的列', { table, column })
}
