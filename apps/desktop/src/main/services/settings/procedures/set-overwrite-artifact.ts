import { logger as baseLogger } from '../../logger'
import { setOverwriteArtifact } from '../../build/lib/settings'
import { setOverwriteArtifactInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setOverwriteArtifact')

/**
 * 「新增 APK 覆盖原有包体」开关。
 *
 * 只影响归档那一步：开的时候同名产物直接覆盖，关的时候回到「重名加时间戳」。
 * 构建本身、以及项目自己的 build/outputs 都不受影响。主进程是这份偏好的唯一持有者，
 * 执行器每次归档时现读，渲染层不缓存第二份。
 */
export function updateOverwriteArtifact(input: unknown): SettingsResult {
  const parsed = setOverwriteArtifactInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('，'),
      settings: null
    }
  }

  try {
    setOverwriteArtifact(parsed.data.enabled)
    logger.info('覆盖同名产物', { enabled: parsed.data.enabled })
    return readSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存覆盖产物开关失败', { error: message })
    return { success: false, error: '保存覆盖产物开关失败', settings: null }
  }
}