import type { BuildPhase, BuildProgress, BuildStagePoint } from '../types/build'

/** 阶段的中文名。都是「正在做什么」，不是「做到了百分之几」——分母拿不到，就不编 */
export const PHASE_LABEL: Record<BuildPhase, string> = {
  starting: '准备环境',
  configuring: '解析工程',
  downloading: '下载依赖',
  executing: '编译',
  packaging: '打包',
  archiving: '归档产物',
  verifying: '校验签名',
  done: '完成'
}

/**
 * 任务名 → 更具体的步骤。
 *
 * 比阶段细一档：「编译」阶段里，用户想知道是在处理资源还是在跑 javac。
 * 认不出就返回 null，界面回退到阶段名 —— 不猜。
 */
export function taskStageLabel(task: string | null): string | null {
  if (task === null || task === '') {
    return null
  }
  if (/^pre/i.test(task)) {
    return '准备'
  }
  if (/Resources|Manifest|Assets/i.test(task)) {
    return '处理资源'
  }
  if (/^compile/i.test(task) || /Kotlin/i.test(task)) {
    return '编译源码'
  }
  if (/^dex/i.test(task) || /Dex/.test(task) || /^package/i.test(task) || /^bundle/i.test(task)) {
    return '打包'
  }
  if (/^lint/i.test(task)) {
    return '检查'
  }
  if (/^assemble/i.test(task)) {
    return '收尾'
  }
  return null
}

/** 一句话说明现在在干嘛：优先具体步骤，其次阶段 */
export function progressHeadline(progress: Pick<BuildProgress, 'phase' | 'task'>): string {
  return taskStageLabel(progress.task) ?? PHASE_LABEL[progress.phase]
}

/** 已执行的任务数；还是 0 时不显示，免得刚点下构建就出现「已执行 0 个」 */
export function progressCountText(progress: Pick<BuildProgress, 'tasksDone'>): string | null {
  return progress.tasksDone > 0 ? `已执行 ${progress.tasksDone} 个任务` : null
}

/** 阶段切换点的一行文字：给历史记录与运行中共用 */
export function stagePointText(point: Pick<BuildStagePoint, 'phase' | 'task' | 'tasksDone'>): string {
  const head = taskStageLabel(point.task) ?? PHASE_LABEL[point.phase]
  const detail = point.task === null ? '' : ` · ${point.task}`
  return `${head}${detail}`
}

/**
 * 日志行 → 阶段标识。返回 null 表示这行不属于任何阶段节点（普通任务输出）。
 *
 * 只用于「旧记录没有阶段序列」时从日志正文里回退压缩。
 */
export function stageKeyOfLine(line: string): string | null {
  const trimmed = line.trim()
  if (trimmed === '') {
    return null
  }

  const taskLine = /^> Task (\S+)/.exec(trimmed)
  if (taskLine) {
    const taskPath = taskLine[1] ?? ''
    const name = taskPath.slice(taskPath.lastIndexOf(':') + 1)
    return 'task:' + (taskStageLabel(name) ?? name)
  }

  if (trimmed.startsWith('> Configure project ')) {
    return 'configure'
  }
  if (/^Download(?:ing)? https?:/i.test(trimmed)) {
    return 'download'
  }
  if (trimmed.startsWith('Starting a Gradle Daemon') || /^Reusing configuration cache/.test(trimmed)) {
    return 'start'
  }
  if (/^BUILD (SUCCESSFUL|FAILED)/.test(trimmed) || trimmed.startsWith('FAILURE:')) {
    return 'done'
  }

  return null
}

/**
 * 把日志压成「阶段切换点」。
 *
 * 同一阶段里连续的 `> Task` 只留第一条 —— 一个工程几百上千行任务输出，
 * 压完通常只剩十几行，正好是「不想逐行读日志但仍想知道走到哪」需要的粒度。
 * 普通任务输出（不带阶段语义的行）直接丢掉。
 */
export function collapseToStageChanges(lines: string[]): string[] {
  const out: string[] = []
  let lastKey: string | null = null
  for (const line of lines) {
    const key = stageKeyOfLine(line)
    if (key === null || key === lastKey) {
      continue
    }
    lastKey = key
    out.push(line)
  }
  return out
}
