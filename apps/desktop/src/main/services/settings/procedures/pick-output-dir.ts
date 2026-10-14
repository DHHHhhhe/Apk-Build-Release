import { mkdirSync } from 'node:fs'
import { dialog } from 'electron'
import { BrowserWindow } from 'electron'
import { logger as baseLogger } from '../../logger'
import type { SettingsResult } from '../types'
import { updateOutputRoot } from './set-output-root'

const logger = baseLogger.scope('settings:pickOutputDir')

/** 选统一输出目录：选完直接落库，少一次往返 */
export async function pickOutputRoot(): Promise<SettingsResult> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const result = window
    ? await dialog.showOpenDialog(window, {
        title: '选择统一输出目录',
        properties: ['openDirectory', 'createDirectory']
      })
    : await dialog.showOpenDialog({
        title: '选择统一输出目录',
        properties: ['openDirectory', 'createDirectory']
      })

  const picked = result.filePaths[0]
  if (result.canceled || !picked) {
    return { success: true, settings: null }
  }

  try {
    mkdirSync(picked, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('输出目录无法创建', { path: picked, error: message })
    return { success: false, error: `这个目录用不了：${message}`, settings: null }
  }

  return updateOutputRoot({ path: picked })
}
