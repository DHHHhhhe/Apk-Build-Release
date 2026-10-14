import { spawn } from 'node:child_process'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('queue:cancel')

interface RunningEntry {
  /** 正在跑的 Gradle 客户端进程 pid，用于杀进程树 */
  pid: number | null
  canceled: boolean
}

/** 正在执行的队列项。key = queueItemId */
const running = new Map<string, RunningEntry>()

export function registerRunning(itemId: string): RunningEntry {
  const entry: RunningEntry = { pid: null, canceled: false }
  running.set(itemId, entry)
  return entry
}

export function setRunningPid(itemId: string, pid: number | undefined): void {
  const entry = running.get(itemId)
  if (entry && typeof pid === 'number') {
    entry.pid = pid
  }
}

export function isCancelRequested(itemId: string): boolean {
  return running.get(itemId)?.canceled ?? false
}

export function releaseRunning(itemId: string): void {
  running.delete(itemId)
}

/** 请求取消：标记 + 立刻杀进程树，宽限期由 Gradle 自己退出（这里直接强杀，避免留下孤儿 java） */
export function requestCancel(itemId: string): boolean {
  const entry = running.get(itemId)
  if (!entry) {
    return false
  }
  entry.canceled = true
  if (entry.pid !== null) {
    logger.info('取消构建，杀进程树', { itemId, pid: entry.pid })
    killProcessTree(entry.pid)
  }
  return true
}

/** 工具退出时把还在跑的构建一并收掉，避免留下孤儿 java 进程 */
export function killAllRunning(): void {
  for (const [itemId, entry] of running.entries()) {
    entry.canceled = true
    if (entry.pid !== null) {
      logger.warn('退出时中止仍在跑的构建', { itemId, pid: entry.pid })
      killProcessTree(entry.pid)
    }
  }
  running.clear()
}

export function runningCount(): number {
  return running.size
}

/** Windows 上 gradlew.bat 会派生 cmd.exe → java.exe，必须杀整棵进程树 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 进程已经退出
    }
  }
}
