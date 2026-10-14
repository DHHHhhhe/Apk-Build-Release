import { z } from 'zod'

// 项目与变体的跨层契约（主进程与渲染进程共用）

export const variantSourceSchema = z.enum(['static', 'gradle'])

export const projectVariantSchema = z.object({
  name: z.string(),
  flavor: z.string().nullable(),
  buildType: z.string(),
  source: variantSourceSchema
})

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  appModule: z.string().nullable(),
  selectedVariants: z.array(z.string()),
  variants: z.array(projectVariantSchema),
  variantsSource: variantSourceSchema.nullable(),
  variantsResolvedAt: z.number().nullable(),
  /** 静态解析的已知限制提示，界面上要如实展示（例如「flavor 的 applicationId 可能被覆盖」） */
  limitations: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const addProjectInputSchema = z.object({
  path: z.string().min(1, '项目路径不能为空')
})

export const projectIdInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id')
})

export const setVariantsInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  variants: z.array(z.string())
})

export const refreshVariantsInputSchema = z.object({
  projectId: z.string().min(1, '缺少项目 id'),
  /** true 时跳过静态解析，直接跑 Gradle 兜底 */
  force: z.boolean().optional()
})

export const projectListResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  projects: z.array(projectSchema)
})

export const projectResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  project: projectSchema.nullable()
})

export const basicResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional()
})

export type VariantSource = z.infer<typeof variantSourceSchema>
export type ProjectVariant = z.infer<typeof projectVariantSchema>
export type Project = z.infer<typeof projectSchema>
export type AddProjectInput = z.infer<typeof addProjectInputSchema>
export type ProjectIdInput = z.infer<typeof projectIdInputSchema>
export type SetVariantsInput = z.infer<typeof setVariantsInputSchema>
export type RefreshVariantsInput = z.infer<typeof refreshVariantsInputSchema>
export type ProjectListResult = z.infer<typeof projectListResultSchema>
export type ProjectResult = z.infer<typeof projectResultSchema>
export type BasicResult = z.infer<typeof basicResultSchema>
