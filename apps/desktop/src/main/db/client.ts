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
      stage_points TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS build_runs_item_idx ON build_runs (queue_item_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS variant_stats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      variant TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      source_run_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS variant_stats_lookup_idx
      ON variant_stats (project_id, variant, ended_at);
  `)

  // 幂等补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加新字段
  // 项目别名与手动排序是后加的两列 —— 漏了兜底的话，老库一查就报
  // 「no such column: "alias"」，而新装的库因为建表语句里有，完全看不出来。
  ensureColumn('projects', 'alias', 'TEXT')
  ensureColumn('projects', 'sort_order', 'INTEGER')
  ensureColumn('build_runs', 'failure_hint', 'TEXT')
  // 阶段切换点：老记录没有这一列，读出来是 NULL，界面回退到从日志正文压缩
  ensureColumn('build_runs', 'stage_points', 'TEXT')
  ensureColumn('queue_items', 'variants', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn('queue_items', 'note', 'TEXT')
  // 「最近一批」要按批次汇总，老库补上这一列后，老数据为 NULL 走回退分支
  ensureColumn('queue_items', 'batch_id', 'TEXT')

  backfillVariantStats()

  logger.info('数据库就绪', { path: dbPath })
}

/** 每个 (项目, 变体) 最多保留多少条耗时样本：够算中位数并留出余量，又不让表无限长 */
export const VARIANT_STATS_KEEP = 20

/**
 * 老库升级：把已有的成功构建耗时搬进 variant_stats。
 *
 * 只在表为空时跑一次 —— 运行期每次成功构建都会往这张表写，所以非空就说明搬过了。
 * 用户「清空队列记录」只清空 build_runs、这张表仍有数据，因此不会误判成没搬过。
 * 即便判断失误，source_run_id 上的唯一约束也能保证不会翻倍。
 */
function backfillVariantStats(): void {
  const existing = sqlite.prepare('SELECT COUNT(*) AS n FROM variant_stats').get() as { n: number }
  if (existing.n > 0) {
    return
  }

  const result = sqlite
    .prepare(
      `INSERT OR IGNORE INTO variant_stats
         (id, project_id, variant, duration_ms, ended_at, source_run_id, created_at)
       SELECT r.id, q.project_id, r.variant, (r.finished_at - r.started_at), r.finished_at, r.id,
              (unixepoch() * 1000)
         FROM build_runs r
         JOIN queue_items q ON q.id = r.queue_item_id
        WHERE r.state = 'success'
          AND r.finished_at IS NOT NULL
          AND (r.finished_at - r.started_at) > 0`
    )
    .run()

  if (result.changes === 0) {
    return
  }
  pruneVariantStats()
  logger.info('已把历史构建耗时搬进变体统计', { rows: result.changes })
}

/** 裁到每变体最近 VARIANT_STATS_KEEP 条（窗口函数要 SQLite 3.25+，better-sqlite3 自带） */
function pruneVariantStats(): void {
  sqlite
    .prepare(
      `DELETE FROM variant_stats
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY project_id, variant ORDER BY ended_at DESC) AS rn
              FROM variant_stats
          )
          WHERE rn > ?
        )`
    )
    .run(VARIANT_STATS_KEEP)
}

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((item) => item.name === column)) {
    return
  }
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  logger.info('已补上缺失的列', { table, column })
}
