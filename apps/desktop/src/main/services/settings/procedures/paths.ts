import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import { shell } from 'electron'
import { logger as baseLogger } from '../../logger'
import { openPathInputSchema } from '../types'
import type { BasicResult } from '../types'
import { getLogDir } from './get'

const logger = baseLogger.scope('settings:paths')

/**
 * 用系统默认程序打开路径：目录进文件管理器，文件用它关联的默认程序（构建日志就是文件）。
 *
 * 这个通道要同时服务两种对象，所以不能无脑建目录 —— 以前它先 `mkdirSync(path, { recursive: true })`，
 * 而那个调用对**已存在的文件**会抛 EEXIST，于是「日志文件」「打开日志文件」两个按钮
 * 永远返回失败；失败又被渲染层的 `void` 丢掉，用户看到的就是「点了没反应」。
 * 现在只在路径确实不存在时才建目录（输出目录 / 日志目录第一次打开时的那种情况）。
 */
export async function openPath(input: unknown): Promise<BasicResult> {
  const parsed = openPathInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，') }
  }

  const path = parsed.data.path
  if (statOrNull(path) === null) {
    try {
      mkdirSync(path, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      return { success: false, error: `打不开：${message}` }
    }
  }

  const errorMessage = await shell.openPath(path)
  if (errorMessage !== '') {
    return { success: false, error: `打不开：${errorMessage}` }
  }
  return { success: true }
}

/** 路径存在就返回它的 stat；不存在（或读不到，比如权限不足）返回 null */
function statOrNull(path: string): Stats | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
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
