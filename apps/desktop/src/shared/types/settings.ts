import { z } from 'zod'

// 设置域的跨层契约

export const settingsSchema = z.object({
  /** 统一输出目录 */
  outputRoot: z.string(),
  /** 构建日志目录 */
  logDir: z.string()
})

export const settingsResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  settings: settingsSchema.nullable()
})

export const setOutputRootInputSchema = z.object({
  path: z.string().min(1, '输出目录不能为空')
})

export const openPathInputSchema = z.object({
  path: z.string().min(1, '缺少路径')
})

export const basicResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional()
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingsResult = z.infer<typeof settingsResultSchema>
export type SetOutputRootInput = z.infer<typeof setOutputRootInputSchema>
export type OpenPathInput = z.infer<typeof openPathInputSchema>
export type BasicResult = z.infer<typeof basicResultSchema>
