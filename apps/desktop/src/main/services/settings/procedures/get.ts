import { join } from 'node:path'
import { app } from 'electron'
import { logger as baseLogger } from '../../logger'
import { getAutoCheckUpdate, getOutputRoot, getShowVariantProgress, getThemeChoice } from '../../build/lib/settings'
import type { SettingsResult } from '../types'

const logger = baseLogger.scope('settings:get')

/** 日志目录：主进程按 runId 落盘的构建日志都放这里 */
export function getLogDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function readSettings(): SettingsResult {
  try {
    return {
      success: true,
      settings: {
        outputRoot: getOutputRoot(),
        logDir: getLogDir(),
        theme: getThemeChoice(),
        autoCheckUpdate: getAutoCheckUpdate(),
        showVariantProgress: getShowVariantProgress()
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('读取设置失败', { error: message })
    return { success: false, error: '读取设置失败', settings: null }
  }
}
