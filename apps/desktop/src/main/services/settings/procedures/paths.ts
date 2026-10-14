import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import { logger as baseLogger } from '../../logger'
import { openPathInputSchema } from '../types'
import type { BasicResult } from '../types'
import { getLogDir } from './get'

const logger = baseLogger.scope('settings:paths')

/** 用系统文件管理器打开目录（输出目录、日志目录都用它） */
export async function openDirectory(input: unknown): Promise<BasicResult> {
  const parsed = openPathInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，') }
  }

  const path = parsed.data.path
  try {
    mkdirSync(path, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { success: false, error: `打不开这个目录：${message}` }
  }

  const errorMessage = await shell.openPath(path)
  if (errorMessage !== '') {
    return { success: false, error: `打不开这个目录：${errorMessage}` }
  }
  return { success: true }
}

/** 清理构建日志：只删日志目录里的 .log，不动别的文件 */
export function clearLogs(): BasicResult & { removed: number; freedBytes: number } {
  const logDir = getLogDir()
  let removed = 0
  let freedBytes = 0

  try {
    for (const entry of readdirSync(logDir)) {
      if (!entry.toLowerCase().endsWith('.log')) {
        continue
      }
      const fullPath = join(logDir, entry)
      try {
        freedBytes += statSync(fullPath).size
        rmSync(fullPath, { force: true })
        removed += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        logger.warn('日志删不掉', { path: fullPath, error: message })
      }
    }
  } catch {
    // 目录不存在就是没日志，不算错
    return { success: true, removed: 0, freedBytes: 0 }
  }

  logger.info('已清理构建日志', { removed, freedBytes })
  return { success: true, removed, freedBytes }
}
