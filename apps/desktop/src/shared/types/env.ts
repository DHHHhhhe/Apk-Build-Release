import { z } from 'zod'

// 环境自检的结果模型：跨 IPC 边界，主进程与渲染进程共用同一份 Zod 定义

export const envItemIdSchema = z.enum(['java', 'androidSdk', 'gradlew'])

export const envItemStateSchema = z.enum([
  'ok', // 找到了且可用
  'warn', // 找到了但有问题（版本不符、路径可疑、与其他来源冲突）
  'error' // 没找到或不可用
])

export const envProbeItemSchema = z.object({
  id: envItemIdSchema,
  label: z.string(),
  state: envItemStateSchema,
  /** 命中的值（路径或版本号），没命中为 null */
  value: z.string().nullable(),
  /** 这个值从哪来的，例如 local.properties 的 sdk.dir / ANDROID_HOME / JAVA_HOME */
  source: z.string().nullable(),
  /** 给用户看的一句话说明 */
  detail: z.string().nullable()
})

export const envProbeInputSchema = z.object({
  /** 可选：带上项目目录就能读到该项目的 local.properties 与 gradle-wrapper */
  projectPath: z.string().min(1).optional()
})

export const envProbeResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  projectPath: z.string().nullable(),
  items: z.array(envProbeItemSchema),
  warnings: z.array(z.string()),
  probedAt: z.number()
})

export type EnvItemId = z.infer<typeof envItemIdSchema>
export type EnvItemState = z.infer<typeof envItemStateSchema>
export type EnvProbeItem = z.infer<typeof envProbeItemSchema>
export type EnvProbeInput = z.infer<typeof envProbeInputSchema>
export type EnvProbeResult = z.infer<typeof envProbeResultSchema>
