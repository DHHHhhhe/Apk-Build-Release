import { z } from 'zod'
import { QUEUE_CONCURRENCY } from '../constants/queue'
import { buildFailureKindSchema } from './build'

// 队列域的跨层契约

export const queueItemStateSchema = z.enum(['pending', 'running', 'success', 'failed', 'canceled'])

/** 队列项里单个变体的构建情况：界面要显示每个变体自己的耗时与失败原因 */
export const queueRunDetailSchema = z.object({
  variant: z.string(),
  state: z.enum(['running', 'success', 'failed', 'canceled']),
  /** 还没开始就是 null */
  startedAt: z.number().nullable(),
  /** 跑完才有值；跑着的由界面用 startedAt 自己算 */
  durationMs: z.number().nullable(),
  /** 失败原因：界面上不切项目就能看到「该改什么」 */
  failureKind: buildFailureKindSchema.nullable(),
  failureHint: z.string().nullable(),
  /** 产物名（实际落盘名）与日志文件位置，供界面直接打开 */
  apkName: z.string().nullable(),
  apkPath: z.string().nullable(),
  logPath: z.string().nullable()
})

export const queueItemSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectPath: z.string(),
  state: queueItemStateSchema,
  /** 入队时冻结的变体列表 */
  variants: z.array(z.string()),
  attempt: z.number(),
  enqueuedAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  note: z.string().nullable(),
  /** 这一项里每个变体的构建记录（含耗时），按开始时间排序 */
  runs: z.array(queueRunDetailSchema)
})

export const enqueueInputSchema = z.object({
  projectIds: z.array(z.string().min(1)).min(1, '至少要选一个项目')
})

export const setConcurrencyInputSchema = z.object({
  limit: z
    .number()
    .min(QUEUE_CONCURRENCY.MIN, '并发上限至少 1')
    .max(QUEUE_CONCURRENCY.MAX, `并发上限最高 ${QUEUE_CONCURRENCY.MAX}`)
})

export const queueItemInputSchema = z.object({
  itemId: z.string().min(1, '缺少队列项 id')
})

export const clearQueueInputSchema = z.object({
  scope: z.enum(['finished', 'all'])
})

export const queueListResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  concurrency: z.number(),
  items: z.array(queueItemSchema)
})

export const queueMutationResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  items: z.array(queueItemSchema)
})

export const queueStateEventSchema = z.object({
  item: queueItemSchema
})

export type QueueItemState = z.infer<typeof queueItemStateSchema>
export type QueueRunDetail = z.infer<typeof queueRunDetailSchema>
export type QueueItem = z.infer<typeof queueItemSchema>
export type EnqueueInput = z.infer<typeof enqueueInputSchema>
export type SetConcurrencyInput = z.infer<typeof setConcurrencyInputSchema>
export type QueueItemInput = z.infer<typeof queueItemInputSchema>
export type ClearQueueInput = z.infer<typeof clearQueueInputSchema>
export type QueueListResult = z.infer<typeof queueListResultSchema>
export type QueueMutationResult = z.infer<typeof queueMutationResultSchema>
export type QueueStateEvent = z.infer<typeof queueStateEventSchema>
