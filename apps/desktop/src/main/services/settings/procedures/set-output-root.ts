import { existsSync, statSync } from 'node:fs'
import { logger as baseLogger } from '../../logger'
import { setOutputRoot } from '../../build/lib/settings'
import { setOutputRootInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setOutputRoot')

export function updateOutputRoot(input: unknown): SettingsResult {
  const parsed = setOutputRootInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), settings: null }
  }

  const path = parsed.data.path.trim()
  if (existsSync(path) && !statSync(path).isDirectory()) {
    return { success: false, error: '输出目录要选一个目录，不是文件', settings: null }
  }

  try {
    setOutputRoot(path)
    logger.info('统一输出目录已更新', { path })
    return readSettings()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('保存输出目录失败', { error: message })
    return { success: false, error: '保存输出目录失败', settings: null }
  }
}
