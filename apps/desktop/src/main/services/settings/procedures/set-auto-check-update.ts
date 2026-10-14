import { logger as baseLogger } from '../../logger'
import { setAutoCheckUpdate } from '../../build/lib/settings'
import { setAutoCheckUpdateInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setAutoCheckUpdate')

/**
 * 「启动时自动检查更新」开关。
 *
 * 关掉只影响**启动后那一次自动检查**：手动点「检查更新」照旧工作，已经下好的更新也照旧提示安装。
 * 主进程是这份偏好的唯一持有者，渲染层不缓存第二份（见 hooks/useAutoCheckUpdate.ts）。
 */
export function updateAutoCheckUpdate(input: unknown): SettingsResult {
  const parsed = setAutoCheckUpdateInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('，'),
      settings: null
    }
  }

  try {
    setAutoCheckUpdate(parsed.data.enabled)
    logger.info('启动时自动检查更新', { enabled: parsed.data.enabled })
    return readSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存自动检查开关失败', { error: message })
    return { success: false, error: '保存自动检查开关失败', settings: null }
  }
}
