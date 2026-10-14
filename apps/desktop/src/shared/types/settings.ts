import { z } from 'zod'

// 设置域的跨层契约

/**
 * 主题档位。**真正决定深浅的是主进程的 `nativeTheme.themeSource`** —— 它一处改动会同时
 * 决定渲染层的 `prefers-color-scheme`、Electron 自绘界面与系统画的窗口边框，
 * 所以这里只表达「用户选了哪一档」，不表达「现在是深是浅」。
 */
export const themeChoiceSchema = z.enum(['system', 'light', 'dark'])

export const settingsSchema = z.object({
  /** 统一输出目录 */
  outputRoot: z.string(),
  /** 构建日志目录 */
  logDir: z.string(),
  /** 主题档位：跟随系统 / 浅色 / 深色 */
  theme: themeChoiceSchema,
  /** 启动后是否自动检查更新；关掉后只有手动点「检查更新」才会查 */
  autoCheckUpdate: z.boolean()
})

export const settingsResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  settings: settingsSchema.nullable()
})

export const setOutputRootInputSchema = z.object({
  path: z.string().min(1, '输出目录不能为空')
})

export const setThemeInputSchema = z.object({
  theme: themeChoiceSchema
})

export const setAutoCheckUpdateInputSchema = z.object({
  enabled: z.boolean()
})

export const openPathInputSchema = z.object({
  path: z.string().min(1, '缺少路径')
})

export const basicResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional()
})

export type ThemeChoice = z.infer<typeof themeChoiceSchema>
export type Settings = z.infer<typeof settingsSchema>
export type SettingsResult = z.infer<typeof settingsResultSchema>
export type SetOutputRootInput = z.infer<typeof setOutputRootInputSchema>
export type SetThemeInput = z.infer<typeof setThemeInputSchema>
export type SetAutoCheckUpdateInput = z.infer<typeof setAutoCheckUpdateInputSchema>
export type OpenPathInput = z.infer<typeof openPathInputSchema>
export type BasicResult = z.infer<typeof basicResultSchema>
