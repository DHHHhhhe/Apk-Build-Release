import { z } from 'zod'

// 构建域的跨层契约

export const buildRunStateSchema = z.enum(['running', 'success', 'failed', 'canceled'])

export const buildFailureKindSchema = z.enum([
  'oom',
  'missing-sdk',
  'missing-gradlew',
  'java-version',
  'timeout',
  'gradle',
  'unknown'
])

/**
 * 构建阶段：Gradle 之外的几段由执行器直接报，Gradle 内部由输出解析器推。
 *
 * 语义按时间顺序排：archiving（定位并复制产物）在 verifying（校验签名）之前，
 * 与 executor 里的实际调用顺序一致。
 */
export const buildPhaseSchema = z.enum([
  'starting',
  'configuring',
  'downloading',
  'executing',
  'packaging',
  'archiving',
  'verifying',
  'done'
])

/**
 * 一个阶段切换点：同一阶段里连续的 Gradle 任务只记第一条。
 *
 * 这份序列是「只看关键节点」的数据来源：它由解析器在构建过程中累积，
 * 不依赖日志正文 —— 日志只保留尾部窗口，大工程的关键节点会被挤出窗口，
 * 于是界面上曾经出现过「勾了关键节点却是空的」。
 */
export const buildStagePointSchema = z.object({
  phase: buildPhaseSchema,
  /** 触发这次切换的任务名；阶段切换（如 BUILD SUCCESSFUL）时为 null */
  task: z.string().nullable(),
  /** 掐在这一步时已经执行了多少个任务 */
  tasksDone: z.number(),
  at: z.number()
})

export const buildRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  variant: z.string(),
  state: buildRunStateSchema,
  exitCode: z.number().nullable(),
  logPath: z.string().nullable(),
  apkPath: z.string().nullable(),
  apkName: z.string().nullable(),
  applicationId: z.string().nullable(),
  versionName: z.string().nullable(),
  versionCode: z.number().nullable(),
  signed: z.boolean().nullable(),
  failureKind: buildFailureKindSchema.nullable(),
  /** 给用户看的一行失败原因（Gradle 报错片段或超时说明） */
  failureHint: z.string().nullable(),
  /** 阶段切换点：历史记录也能「只看关键节点」，不依赖日志文件还在不在 */
  stages: z.array(buildStagePointSchema),
  startedAt: z.number(),
  finishedAt: z.number().nullable()
})

export const startBuildInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  variants: z.array(z.string()).min(1, '至少要选一个变体')
})

export const projectRunsInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  limit: z.number().min(1).max(100).optional()
})

export const buildListResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  runs: z.array(buildRunSchema)
})

export const startBuildResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  runs: z.array(buildRunSchema)
})

/** 事件推送载荷 */
export const buildLogEventSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  variant: z.string(),
  chunk: z.string()
})

export const buildStateEventSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  variant: z.string(),
  state: buildRunStateSchema,
  run: buildRunSchema
})

/**
 * 一个变体的构建进度。
 *
 * 刻意不含百分比：Gradle 的 --console=plain 输出不带任务总数，凑不出可信分母。
 * 界面只展示「阶段 + 当前任务 + 已执行任务数」，数量单调递增，不假装知道还剩多少。
 */
export const buildProgressSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  variant: z.string(),
  phase: buildPhaseSchema,
  /** 当前正在执行的 Gradle 任务短名（已去掉模块前缀）；不在任务里时为 null */
  task: z.string().nullable(),
  /** 实际执行过的任务数（跳过的不算） */
  tasksDone: z.number(),
  /** UP-TO-DATE / FROM-CACHE 等被跳过的任务数 */
  tasksSkipped: z.number(),
  /** 到目前为止的阶段切换点（最多 200 条） */
  stages: z.array(buildStagePointSchema),
  updatedAt: z.number()
})

export const buildProgressEventSchema = buildProgressSchema

export type BuildRunState = z.infer<typeof buildRunStateSchema>
export type BuildFailureKind = z.infer<typeof buildFailureKindSchema>
export type BuildPhase = z.infer<typeof buildPhaseSchema>
export type BuildStagePoint = z.infer<typeof buildStagePointSchema>
export type BuildProgress = z.infer<typeof buildProgressSchema>
export type BuildProgressEvent = z.infer<typeof buildProgressEventSchema>
export type BuildRun = z.infer<typeof buildRunSchema>
export type StartBuildInput = z.infer<typeof startBuildInputSchema>
export type ProjectRunsInput = z.infer<typeof projectRunsInputSchema>
export type BuildListResult = z.infer<typeof buildListResultSchema>
export type StartBuildResult = z.infer<typeof startBuildResultSchema>
export type BuildLogEvent = z.infer<typeof buildLogEventSchema>
export type BuildStateEvent = z.infer<typeof buildStateEventSchema>

// ── 结果汇总 ──
// 「这一批到底出了哪些包」要有地方一次看全，而不是逐个项目翻构建记录

export const summaryScopeSchema = z.enum(['latest', 'all'])

export const summaryArtifactSchema = z.object({
  variant: z.string(),
  state: buildRunStateSchema,
  durationMs: z.number().nullable(),
  finishedAt: z.number().nullable(),
  apkName: z.string().nullable(),
  apkPath: z.string().nullable(),
  /** 产物大小；文件已被删或不存在时为 0 */
  apkBytes: z.number(),
  apkMissing: z.boolean(),
  signed: z.boolean().nullable(),
  versionName: z.string().nullable(),
  applicationId: z.string().nullable(),
  failureHint: z.string().nullable()
})

export const summaryGroupSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  artifacts: z.array(summaryArtifactSchema)
})

export const buildSummarySchema = z.object({
  scope: summaryScopeSchema,
  totals: z.object({
    projects: z.number(),
    variants: z.number(),
    success: z.number(),
    failed: z.number(),
    canceled: z.number(),
    /** 已结束变体的耗时合计 */
    durationMs: z.number(),
    apkCount: z.number(),
    apkBytes: z.number(),
    unsignedCount: z.number()
  }),
  groups: z.array(summaryGroupSchema),
  outputRoot: z.string()
})

export const buildSummaryInputSchema = z.object({
  scope: summaryScopeSchema
})

export const buildSummaryResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  summary: buildSummarySchema.nullable()
})

export type SummaryScope = z.infer<typeof summaryScopeSchema>
export type SummaryArtifact = z.infer<typeof summaryArtifactSchema>
export type SummaryGroup = z.infer<typeof summaryGroupSchema>
export type BuildSummary = z.infer<typeof buildSummarySchema>
export type BuildSummaryInput = z.infer<typeof buildSummaryInputSchema>
export type BuildSummaryResult = z.infer<typeof buildSummaryResultSchema>
