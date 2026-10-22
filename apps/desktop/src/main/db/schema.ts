import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// 时间戳一律 timestamp_ms（.trellis/spec/backend/database.md + shared/timestamp.md）
const nowMs = sql`(unixepoch() * 1000)`

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull().unique(),
    /** 应用了 com.android.application 的模块路径，例如 :app */
    appModule: text('app_module'),
    /** 分发用的别名：输出目录下的文件夹名优先用它；空表示仍用项目名 */
    alias: text('alias'),
    /** 左侧列表的手工排序位：越小越靠前，null 表示还没排过（按创建时间兜底） */
    sortOrder: integer('sort_order'),
    /** 用户勾选的变体名，JSON 数组 */
    selectedVariants: text('selected_variants').notNull().default('[]'),
    /** 变体列表是怎么来的：static / gradle */
    variantsSource: text('variants_source', { enum: ['static', 'gradle'] }),
    /** 相关构建文件的 mtime 签名，用于判断能否复用缓存 */
    variantsSignature: text('variants_signature'),
    /** 静态解析的已知限制提示，JSON 数组 */
    variantsNotes: text('variants_notes').notNull().default('[]'),
    variantsResolvedAt: integer('variants_resolved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date())
  },
  (table) => [index('projects_path_idx').on(table.path)]
)

export const projectVariants = sqliteTable(
  'project_variants',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    flavor: text('flavor'),
    buildType: text('build_type').notNull(),
    source: text('source', { enum: ['static', 'gradle'] }).notNull(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (table) => [index('project_variants_project_idx').on(table.projectId)]
)

export const queueItems = sqliteTable(
  'queue_items',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['pending', 'running', 'success', 'failed', 'canceled'] })
      .notNull()
      .default('pending'),
    /** 入队时冻结的变体列表（JSON）；重试时沿用同一份，不受之后改选影响 */
    variants: text('variants').notNull().default('[]'),
    /**
     * 批次 id：同一次「构建勾选项」入队的所有项目共用一个值。
     *
     * 一次跨项目入队会建 N 条队列项，而汇总的「最近一批」要的是**这一次**的全部项目，
     * 不是最后一条。老数据没有这个字段（null），汇总会按它自己那一条回退。
     */
    batchId: text('batch_id'),
    attempt: integer('attempt').notNull().default(1),
    enqueuedAt: integer('enqueued_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    /** 失败或取消的原因，给用户看的一行 */
    note: text('note')
  },
  (table) => [index('queue_items_state_idx').on(table.state)]
)

export const buildRuns = sqliteTable(
  'build_runs',
  {
    id: text('id').primaryKey(),
    queueItemId: text('queue_item_id')
      .notNull()
      .references(() => queueItems.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(),
    state: text('state', { enum: ['running', 'success', 'failed', 'canceled'] })
      .notNull()
      .default('running'),
    exitCode: integer('exit_code'),
    /** 日志落在 userData/logs/<runId>.log，库里只存路径 */
    logPath: text('log_path'),
    apkPath: text('apk_path'),
    apkName: text('apk_name'),
    applicationId: text('application_id'),
    versionName: text('version_name'),
    versionCode: integer('version_code'),
    signed: integer('signed', { mode: 'boolean' }),
    /** OOM / 缺 SDK / 环境错误 等分类，便于给出可读原因 */
    failureKind: text('failure_kind', {
      enum: ['oom', 'missing-sdk', 'missing-gradlew', 'java-version', 'timeout', 'gradle', 'unknown']
    }),
    /** 给用户看的一行失败原因 */
    failureHint: text('failure_hint'),
    /** 阶段切换点（JSON 数组）：历史记录也能「只看关键节点」，不依赖日志文件 */
    stagePoints: text('stage_points'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().default(nowMs),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' })
  },
  (table) => [index('build_runs_item_idx').on(table.queueItemId)]
)

/** 键值配置：统一输出目录等（设置界面在后续阶段接入） */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(nowMs)
    .$onUpdate(() => new Date())
})

/**
 * 变体耗时统计：队列里那条进度条的估算依据。
 *
 * 刻意**不挂在 queue_items 名下**。构建记录是队列项的子表，用户一点「清空队列记录」
 * 就级联删光，预估依据也跟着没了 —— 于是勤清记录的人永远看不到进度条。
 * 这张表只按项目级联删除，清队列记录不动它。
 *
 * 只记成功构建：失败/取消的 run 大多提前退出，混进样本会把预估拉低。
 */
export const variantStats = sqliteTable(
  'variant_stats',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(),
    /** 这次构建耗时（毫秒），只存正数 */
    durationMs: integer('duration_ms').notNull(),
    /** 构建结束时刻：取「最近 N 条」按它排序 */
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * 来源构建记录 id。老库升级时从 build_runs 搬过来，靠它的唯一约束保证重复迁移不翻倍；
     * 运行期写入就是那一次的 run id。
     */
    sourceRunId: text('source_run_id').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(nowMs)
  },
  (table) => [index('variant_stats_lookup_idx').on(table.projectId, table.variant, table.endedAt)]
)

export type ProjectRow = typeof projects.$inferSelect
export type ProjectVariantRow = typeof projectVariants.$inferSelect
export type QueueItemRow = typeof queueItems.$inferSelect
export type BuildRunRow = typeof buildRuns.$inferSelect
export type VariantStatRow = typeof variantStats.$inferSelect
