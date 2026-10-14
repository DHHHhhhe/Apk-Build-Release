import { clipboard } from 'electron'
import { logger as baseLogger } from '../services/logger'

const logger = baseLogger.scope('app')

/** 复制文本到剪贴板。渲染进程在 file:// 下没有 navigator.clipboard，只能回主进程做 */
export function copyTextToClipboard(text: string): { success: boolean; error?: string } {
  if (typeof text !== 'string' || text === '') {
    return { success: false, error: '没有可复制的内容' }
  }
  try {
    clipboard.writeText(text)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('写剪贴板失败', { error: message })
    return { success: false, error: '复制失败' }
  }
}
