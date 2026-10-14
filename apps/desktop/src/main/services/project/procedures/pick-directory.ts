import { BrowserWindow, dialog } from 'electron'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('project:pickDirectory')

export interface PickDirectoryResult {
  success: boolean
  error?: string
  path: string | null
}

/** 原生目录选择必须走主进程（渲染进程没有文件系统能力） */
export async function pickProjectDirectory(): Promise<PickDirectoryResult> {
  try {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openDirectory'], title: '选择 Android 项目目录' })
      : await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择 Android 项目目录' })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, path: null }
    }
    return { success: true, path: result.filePaths[0] ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('打开目录选择框失败', { error: message })
    return { success: false, error: '打开目录选择框失败', path: null }
  }
}
