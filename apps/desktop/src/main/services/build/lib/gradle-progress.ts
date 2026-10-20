import type { BuildPhase, BuildStagePoint } from '@shared/types/build'
import { taskStageLabel } from '@shared/lib/build-stage'

/**
 * 从 Gradle 输出里解析「现在到哪一步了」。
 *
 * 为什么不用百分比：`--console=plain` 的输出只有逐行 `> Task`，不带任务总数，
 * 分母拿不到就没法算百分比（`--dry-run` 能列出任务，但那会先完整配置一次工程，
 * 几十秒起步，而且列出的集合不等于实际会跑的集合）。所以这里只给
 * 「阶段 + 当前任务 + 已执行任务数」，三个都是可观测量。
 *
 * 解析是全尽力而为的：任何一行认不出来就跳过，绝不影响构建本身。
 */
export interface GradleProgress {
  phase: BuildPhase
  /** 当前任务短名（去掉模块前缀），没有在跑任务时为 null */
  task: string | null
  tasksDone: number
  tasksSkipped: number
  /** 到目前为止的阶段切换点（同一阶段里的连续任务只记第一条） */
  stages: BuildStagePoint[]
}

/** 阶段切换点最多留这么多条：只用于展示，超出就丢最早的 */
const MAX_STAGE_POINTS = 200

/** Gradle 认为「这个任务不用跑」的标记 */
const SKIPPED_MARKS = new Set(['UP-TO-DATE', 'FROM-CACHE', 'SKIPPED', 'NO-SOURCE'])

/**
 * `> Task :app:compileFreeDebugJavaWithJavac`
 * `> Task :app:preBuild UP-TO-DATE`
 *
 * 模块前缀可能不止一段（`:lib:sub:task`），所以用 \S+ 整体匹配，再按最后一个冒号截短名。
 */
const TASK_LINE = /^> Task (\S+)(?: (\S+))?\s*$/
const DOWNLOAD_LINE = /^Download(?:ing)? https?:/i
const DONE_LINE = /^BUILD (SUCCESSFUL|FAILED)/

/**
 * 任务名 → 阶段。只区分两档：最后组装 APK 的那几类算 packaging，其余都算 executing。
 * 更细的「编译 / 处理资源」由界面按任务名给标签，不在这层判断。
 */
export function phaseForTask(taskName: string): BuildPhase {
  return /^(package|bundle|dex|merge.*Dex|assemble)/i.test(taskName) ? 'packaging' : 'executing'
}

/** 去掉模块前缀：`:app:compileFreeDebugJavaWithJavac` → `compileFreeDebugJavaWithJavac` */
export function shortTaskName(taskPath: string): string {
  const at = taskPath.lastIndexOf(':')
  return at === -1 ? taskPath : taskPath.slice(at + 1)
}

export class GradleProgressParser {
  /** 上一块 chunk 末尾没有换行的那一行，等下一块接上再解析 */
  private tail = ''

  private progress: GradleProgress = {
    phase: 'starting',
    task: null,
    tasksDone: 0,
    tasksSkipped: 0,
    stages: []
  }

  /** 上一条阶段点的归类键：同一阶段里连续的任务不再重复记录 */
  private lastStageKey: string | null = null

  /**
   * 喂一块输出。返回新的进度快照；没有实质变化时返回 null（调用方据此决定是否推送）。
   */
  feed(chunk: string): GradleProgress | null {
    if (chunk === '') {
      return null
    }

    const before = this.key()
    this.tail += chunk

    // 三种换行都要处理：Windows 的 \r\n、单独 \r（rich 控制台残留）、以及 \n
    const lines = this.tail.split(/\r\n|\r|\n/)
    // 最后一段可能被 chunk 切断，留到下一块；以换行结尾时它是空串，正好也是「没有残行」
    this.tail = lines.pop() ?? ''

    // 兜底：万一遇到不带换行的巨量输出，别把整段都攒在内存里
    if (this.tail.length > 4096) {
      this.tail = this.tail.slice(-4096)
    }

    for (const line of lines) {
      this.applyLine(line)
    }

    return this.key() === before ? null : this.snapshot()
  }

  /** 取当前快照；执行器在 Gradle 之外的节点（归档、验签）会用它拼事件 */
  snapshot(): GradleProgress {
    return {
      phase: this.progress.phase,
      task: this.progress.task,
      tasksDone: this.progress.tasksDone,
      tasksSkipped: this.progress.tasksSkipped,
      stages: this.progress.stages.map((point) => ({ ...point }))
    }
  }

  /**
   * 由执行器推进 Gradle 之外的阶段（归档产物、校验签名、完成）。
   *
   * 走这里而不是让执行器自己拼一个快照：阶段点必须和阶段一起进序列，
   * 否则「只看关键节点」里永远看不到最后这几步 —— 而它们恰恰是日志里没有的那一段。
   */
  markPhase(phase: BuildPhase): GradleProgress {
    this.progress.phase = phase
    this.progress.task = null
    this.appendStage(phase, null)
    return this.snapshot()
  }

  private key(): string {
    const { phase, task, tasksDone, tasksSkipped, stages } = this.progress
    return `${phase}|${task ?? ''}|${tasksDone}|${tasksSkipped}|${stages.length}`
  }

  /**
   * 记一个阶段切换点。
   *
   * 归类键用的是界面同一套「准备 / 处理资源 / 编译源码 / 打包 / 收尾」：
   * 同一个类别里连续跑几十个任务只算一个节点，这正是「关键节点」要的粒度。
   */
  private appendStage(phase: BuildPhase, task: string | null): void {
    const key = phase + '|' + (taskStageLabel(task) ?? task ?? '')
    if (key === this.lastStageKey) {
      return
    }
    this.lastStageKey = key
    this.progress.stages.push({ phase, task, tasksDone: this.progress.tasksDone, at: Date.now() })
    if (this.progress.stages.length > MAX_STAGE_POINTS) {
      this.progress.stages.splice(0, this.progress.stages.length - MAX_STAGE_POINTS)
    }
  }

  private applyLine(raw: string): void {
    // 去掉行尾空白，但保留前导：Gradle 的任务输出常靠缩进表达层级，这里不需要它，所以统一 trim 前后
    const line = raw.trim()
    if (line === '') {
      return
    }

    const task = TASK_LINE.exec(line)
    if (task) {
      const taskPath = task[1] ?? ''
      const mark = task[2] ?? ''
      if (SKIPPED_MARKS.has(mark)) {
        this.progress.tasksSkipped += 1
        return
      }
      const name = shortTaskName(taskPath)
      if (name === '') {
        return
      }
      this.progress.tasksDone += 1
      this.progress.task = name
      this.progress.phase = phaseForTask(name)
      this.appendStage(this.progress.phase, name)
      return
    }

    if (line.startsWith('> Configure project ')) {
      this.progress.phase = 'configuring'
      this.progress.task = null
      this.appendStage('configuring', null)
      return
    }

    if (DOWNLOAD_LINE.test(line)) {
      this.progress.phase = 'downloading'
      this.progress.task = null
      this.appendStage('downloading', null)
      return
    }

    if (line.startsWith('Starting a Gradle Daemon') || /^Reusing configuration cache/.test(line)) {
      this.progress.phase = 'executing'
      this.appendStage('executing', null)
      return
    }

    if (DONE_LINE.test(line)) {
      // Gradle 自己的活干完了，接下来是执行器定位产物、复制、验签
      this.progress.phase = 'packaging'
      this.progress.task = null
      this.appendStage('packaging', null)
    }
  }
}
