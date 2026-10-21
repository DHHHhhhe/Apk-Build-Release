import { z } from 'zod'
import { QUEUE_CONCURRENCY } from '../constants/queue'
import { buildFailureKindSchema } from './build'

// 队列域的跨层契约

export const queueItemStateSchema = z.enum(['pending', 'running', 'success', 'failed', 'canceled'])

/** 队列项里单个变体的构建情况：界面要显示每个变体自己的耗时与失败原因 */
export const queueRunDetailSchema = z.object({
  /** 构建记录 id：界面靠它把 build:progress 事件对到具体的变体行 */
  id: z.string(),
  variant: z.string(),
  state: z.enum(['running', 'success', 'failed', 'canceled']),
  /** 还没开始就是 null */
  startedAt: z.number().nullable(),
  /** 跑完才有值；跑着的由界面用 startedAt 自己算 */
  durationMs: z.number().nullable(),
  /**
   * 预计总耗时：同项目 + 同变体名最近几次**成功**构建耗时的中位数。
   * 没有历史样本就是 null —— 界面据此决定要不要画进度条，不要用 0 或默认值兜底。
   */
  estimatedMs: z.number().nullable(),
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
  /**
   * 入队批次：一次「构建勾选项」建的所有项共用一个值，追加的变体也沿用当前批次。
   * 界面用它把「当前这一批」与更早的记录分开，免得历史项一直堆在队列里。
   */
  batchId: z.string().nullable(),
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

/**
 * 一个入队目标：项目 + 这次要打的变体。
 *
 * 变体由界面显式给出，不再让主进程回读数据库里「最后保存的那份勾选」——
 * 这样「界面显示什么就构建什么」是**结构上的保证**，不再依赖写入是否先落盘（时序）。
 */
export const enqueueTargetSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  variants: z.array(z.string().min(1))
})

export const enqueueInputSchema = z.object({
  targets: z.array(enqueueTargetSchema).min(1, '至少要选一个项目')
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

/**
 * 重试一条队列项。
 *
 * `variants` 给出时只重跑这些变体 —— 一个项目有 8 个渠道、挂掉 1 个时，
 * 整项重跑等于把另外 7 个也白打一遍。不给就是整项重跑。
 */
export const retryQueueInputSchema = z.object({
  itemId: z.string().min(1, '缺少队列项 id'),
  variants: z.array(z.string().min(1)).optional()
})
export const clearQueueInputSchema = z.object({
  scope: z.enum(['finished', 'all'])
})

export const queueListResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  concurrency: z.number(),
  /**
   * 队列是否处于暂停态：上次退出留下了没跑的项，等用户点「继续上次队列」。
   * 暂停时不会自动开跑，所以界面要把这件事说出来，否则用户以为卡住了。
   */
  paused: z.boolean(),
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
export type EnqueueTarget = z.infer<typeof enqueueTargetSchema>
export type EnqueueInput = z.infer<typeof enqueueInputSchema>
export type SetConcurrencyInput = z.infer<typeof setConcurrencyInputSchema>
export type QueueItemInput = z.infer<typeof queueItemInputSchema>
export type RetryQueueInput = z.infer<typeof retryQueueInputSchema>
export type ClearQueueInput = z.infer<typeof clearQueueInputSchema>
export type QueueListResult = z.infer<typeof queueListResultSchema>
export type QueueMutationResult = z.infer<typeof queueMutationResultSchema>
export type QueueStateEvent = z.infer<typeof queueStateEventSchema>
