import { logger as baseLogger } from '../../logger'
import { saveTheme } from '../../../theme'
import { setThemeInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setTheme')

/**
 * 切换主题档位。真正生效的是主进程的 `nativeTheme.themeSource`（见 `main/theme.ts`），
 * 渲染层只负责把媒体查询的结果投影成 `.dark` 类，所以这里不需要通知界面「现在变深了」——
 * 主进程改完 themeSource，渲染层的 `prefers-color-scheme` 会自己变。
 */
export function updateTheme(input: unknown): SettingsResult {
  const parsed = setThemeInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('，'),
      settings: null
    }
  }

  try {
    saveTheme(parsed.data.theme)
    return readSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存主题档位失败', { error: message })
    return { success: false, error: '保存主题档位失败', settings: null }
  }
}
