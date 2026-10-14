import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { logger as baseLogger } from '../../logger'
import { setOutputRoot } from '../../build/lib/settings'
import { setOutputRootInputSchema } from '../types'
import type { SettingsResult } from '../types'
import { checkOutputRoot } from '../lib/output-root-guard'
import { readSettings } from './get'

const logger = baseLogger.scope('settings:setOutputRoot')

/**
 * 从目标目录往上找最近的一个 Git 仓库根（含 `.git` 的那一层）。
 *
 * 目录可能还没建出来，所以先从「最近的存在祖先」开始往上找。
 * 两个循环都以盘根为界：`dirname` 到了根之后就不再变化，必然退出，不会空转。
 */
function findGitRoot(target: string): string | null {
  let current = resolve(target)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }

  for (;;) {
    if (existsSync(join(current, '.git'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export function updateOutputRoot(input: unknown): SettingsResult {
  const parsed = setOutputRootInputSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('，'), settings: null }
  }

  // 存绝对路径：相对路径会跟着进程的工作目录漂，构建时解析到哪儿是不确定的
  const path = resolve(parsed.data.path.trim())
  if (existsSync(path) && !statSync(path).isDirectory()) {
    return { success: false, error: '输出目录要选一个目录，不是文件', settings: null }
  }

  const guard = checkOutputRoot({ path, gitRoot: findGitRoot(path) })
  if (!guard.ok) {
    logger.warn('拒绝把统一输出目录设在 Git 仓库里', { path })
    return { success: false, error: guard.error, settings: null }
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
