import { logger as baseLogger } from '../../logger'
import { setShowVariantProgress } from '../../build/lib/settings'
import { setShowVariantProgressInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setShowVariantProgress')

/**
 * 「显示变体构建进度条」开关。
 *
 * 关掉只是不再画那条进度条：预估照旧算（它同时也可能被别处用到），
 * 也不影响构建本身。主进程是这份偏好的唯一持有者，渲染层不缓存第二份。
 */
export function updateShowVariantProgress(input: unknown): SettingsResult {
  const parsed = setShowVariantProgressInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('，'),
      settings: null
    }
  }

  try {
    setShowVariantProgress(parsed.data.enabled)
    logger.info('显示变体构建进度条', { enabled: parsed.data.enabled })
    return readSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存进度条开关失败', { error: message })
    return { success: false, error: '保存进度条开关失败', settings: null }
  }
}
