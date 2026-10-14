import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { planSpawn } from '../../../lib/gradle-paths'

export const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000

/**
 * 变体对应的 Gradle 任务名：assemble + 变体名首字母大写。
 * 例：变体 freeDebug → :app:assembleFreeDebug（官方文档与真实项目 tasks 列表都确认过）
 */
export function assembleTaskName(variantName: string): string {
  if (variantName.length === 0) {
    return 'assemble'
  }
  return `assemble${variantName.charAt(0).toUpperCase()}${variantName.slice(1)}`
}

export function variantTaskPath(modulePath: string | null, variantName: string): string {
  const task = assembleTaskName(variantName)
  return modulePath ? `${modulePath}:${task}` : task
}

export interface RunGradleTaskOptions {
  projectPath: string
  gradlewPath: string
  taskPath: string
  logPath: string
  timeoutMs?: number
  /** 每块输出都会回调一次，用于把日志推给界面 */
  onChunk?: (chunk: string) => void
  /** 进程起来后回调 pid，取消时按 pid 杀进程树 */
  onSpawn?: (pid: number | undefined) => void
}

export interface RunGradleTaskResult {
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  logPath: string
  /** 输出尾部，用于失败分类与展示原因 */
  outputTail: string
}

const TAIL_LIMIT = 16_000

export function runGradleTask(options: RunGradleTaskOptions): Promise<RunGradleTaskResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS
  const startedAt = Date.now()

  return new Promise<RunGradleTaskResult>((resolve) => {
    mkdirSync(dirname(options.logPath), { recursive: true })
    const logStream = createWriteStream(options.logPath, { flags: 'a' })

    let tail = ''
    let settled = false
    let timedOut = false

    const plan = planSpawn(
      options.gradlewPath,
      [options.taskPath, '--console=plain'],
      options.projectPath
    )
    const child = spawn(plan.command, plan.args, plan.options)
    options.onSpawn?.(child.pid)

    const append = (chunk: string): void => {
      logStream.write(chunk)
      tail = (tail + chunk).slice(-TAIL_LIMIT)
      options.onChunk?.(chunk)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      append(chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      append(chunk.toString('utf8'))
    })

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child.pid)
    }, timeoutMs)

    const finish = (exitCode: number | null): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      logStream.end()
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        logPath: options.logPath,
        outputTail: tail
      })
    }

    child.on('error', () => {
      finish(null)
    })
    child.on('close', (code) => {
      finish(code)
    })
  })
}

/** Windows 上 gradlew.bat 会派生 cmd.exe → java.exe，必须杀进程树 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid) {
    return
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    process.kill(pid, 'SIGKILL')
  }
}
