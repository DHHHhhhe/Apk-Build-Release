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

export type BuildRunState = z.infer<typeof buildRunStateSchema>
export type BuildFailureKind = z.infer<typeof buildFailureKindSchema>
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
