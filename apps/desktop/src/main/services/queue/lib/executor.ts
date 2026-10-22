import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { BuildProgressEvent, BuildRunState } from '@shared/types/build'
import type { QueueItem, QueueItemState } from '@shared/types/queue'
import { broadcast } from '../../../lib/broadcast'
import { locateGradlew } from '../../../lib/gradle-paths'
import { logger as baseLogger } from '../../logger'
import { copyArtifactToOutput, findApkArtifacts, resolveOutputFolderName } from '../../build/lib/artifacts'
import { classifyFailure } from '../../build/lib/failure'
import { GradleProgressParser, type GradleProgress } from '../../build/lib/gradle-progress'
import {
  createBuildRun,
  getBuildRun,
  toBuildRunDto,
  updateBuildRun
} from '../../build/lib/runs'
import { getOutputRoot } from '../../build/lib/settings'
import { verifyApkSignature } from '../../build/lib/signing'
import { runGradleTask, variantTaskPath } from '../../build/lib/spawn-gradle'
import { locateAndroidSdk } from '../../env/lib/probe'
import { findProjectRow } from '../../project/lib/mapper'
import { parseProjectStatics } from '../../project/lib/parse-gradle'
import { notifyBuildFinished } from '../../notify'
import { isCancelRequested, registerRunning, releaseRunning, setRunningPid } from './cancel'
import { findItemRow, listRunsForItem, parseVariants, toQueueItemDto, updateItem } from './items'
import { recordVariantDuration } from './estimate'

const logger = baseLogger.scope('queue:executor')

/**
 * 进度事件的推送节流。
 *
 * Gradle 一个中等工程会打出几百上千个 `> Task` 行，不节流的话进度事件会和日志抢 IPC；
 * 200ms 一次对肉眼足够，每秒最多 5 条。
 */
const PROGRESS_THROTTLE_MS = 200

/**
 * 执行一条队列项：项目内多个变体顺序执行（D6），单个变体失败不影响后面的变体。
 * 取消请求在变体之间与变体内部都会被检查。
 */
export async function executeQueueItem(itemId: string): Promise<QueueItemState> {
  const item = findItemRow(itemId)
  if (!item) {
    logger.warn('队列项不存在', { itemId })
    return 'failed'
  }

  registerRunning(itemId)
  updateItem(itemId, { state: 'running', startedAt: new Date(), note: null })
  broadcastItem(itemId)

  try {
    const project = findProjectRow(item.projectId)
    if (!project) {
      return finish(itemId, 'failed', '项目已经被移除了')
    }
    if (!existsSync(project.path)) {
      return finish(itemId, 'failed', '项目目录已经不在了，请重新添加')
    }

    const gradlewPath = locateGradlew(project.path)
    if (!gradlewPath) {
      return finish(itemId, 'failed', '项目根目录下没有 gradlew，无法构建')
    }

    const variants = parseVariants(item.variants)
    if (variants.length === 0) {
      return finish(itemId, 'failed', '这一项没有要构建的变体，重新入队时请先选变体')
    }

    const moduleDirs = parseProjectStatics(project.path).modules.map((module) => module.dir)
    const outputRoot = getOutputRoot()
    let anyFailed = false
    let anyCanceled = false

    for (const variant of variants) {
      if (isCancelRequested(itemId)) {
        anyCanceled = true
        break
      }

      const runRow = createBuildRun(itemId, variant)
      const logPath = join(app.getPath('userData'), 'logs', `${runRow.id}.log`)
      updateBuildRun(runRow.id, { logPath })
      broadcastRunState(project.id, variant, runRow.id, 'running')
      // 队列列表只订阅 QUEUE.STATE：这里不广播一次，队列项就会停在入队那一刻的快照
      // （runs 是空的），三个变体一起构建时界面上全都显示「待构建」
      broadcastItem(itemId)

      // 每个变体一个解析器：并发上限大于 1 时，两条构建的输出会交错，共用一份状态会互相覆盖
      const parser = new GradleProgressParser()
      let lastProgressKey = ''
      let lastProgressAt = 0

      const emitProgress = (progress: GradleProgress, force: boolean): void => {
        const key = `${progress.phase}|${progress.task ?? ''}|${progress.tasksDone}`
        const now = Date.now()
        if (!force) {
          // 没有变化不推；有变化但没到节流窗口也不推（最后一帧由 STATE 事件收尾）
          if (key === lastProgressKey || now - lastProgressAt < PROGRESS_THROTTLE_MS) {
            return
          }
        }
        lastProgressKey = key
        lastProgressAt = now
        const event: BuildProgressEvent = {
          runId: runRow.id,
          projectId: project.id,
          variant,
          phase: progress.phase,
          task: progress.task,
          tasksDone: progress.tasksDone,
          tasksSkipped: progress.tasksSkipped,
          // 阶段序列随事件带上：界面「只看关键节点」直接用这份，不再从日志正文里找
          stages: progress.stages,
          updatedAt: now
        }
        broadcast(IPC_CHANNELS.BUILD.PROGRESS, event)
      }

      // Gradle 起来之前的那一小段（写日志文件、拼任务名）也要有状态，
      // 否则点下构建后界面会空白几秒才跳「构建中」
      emitProgress({ phase: 'starting', task: null, tasksDone: 0, tasksSkipped: 0, stages: [] }, true)

      const result = await runGradleTask({
        projectPath: project.path,
        gradlewPath,
        taskPath: variantTaskPath(project.appModule, variant),
        logPath,
        onSpawn: (pid) => {
          setRunningPid(itemId, pid)
        },
        onChunk: (chunk) => {
          broadcast(IPC_CHANNELS.BUILD.LOG, {
            runId: runRow.id,
            projectId: project.id,
            variant,
            chunk
          })
          const next = parser.feed(chunk)
          if (next !== null) {
            emitProgress(next, false)
          }
        }
      })

      const canceled = isCancelRequested(itemId)
      const succeeded = !canceled && !result.timedOut && result.exitCode === 0

      // Gradle 退出后还有两段纯主进程的活：找产物并复制、再调 apksigner 验签。
      // 以前这段时间日志不动、状态还是 running，看起来像卡死。
      if (succeeded) {
        emitProgress(parser.markPhase('archiving'), true)
      }

      const artifact = succeeded
        ? (findApkArtifacts({ projectPath: project.path, moduleDirs, expectedVariant: variant })[0] ?? null)
        : null
      const copiedPath = artifact ? copyArtifactToOutput(artifact, outputRoot, resolveOutputFolderName(project)) : null

      if (succeeded && artifact) {
        emitProgress(parser.markPhase('verifying'), true)
      }

      // 签名状态以 apksigner 为准：文件名只能看出 unsigned，看不出「签了但无效」
      const signature = artifact
        ? await verifyApkSignature({
            apkPath: copiedPath ?? artifact.apkPath,
            sdkDir: locateAndroidSdk(project.path).located?.value ?? null
          })
        : null
      if (signature?.signed === false) {
        logger.warn('产物未签名', { variant, apkName: artifact?.apkName ?? '' })
      }

      const classification = succeeded
        ? null
        : canceled
          ? null
          : classifyFailure({
              exitCode: result.exitCode,
              timedOut: result.timedOut,
              output: result.outputTail
            })

      const hint = canceled
        ? '用户取消'
        : succeeded
          ? artifact
            ? signature?.signed === false
              ? '未签名或签名无效，不能直接安装'
              : null
            : '构建成功，但没定位到该变体的 APK（项目可能自定义了输出目录）'
          : (classification?.hint ?? null)

      const state: BuildRunState = canceled ? 'canceled' : succeeded ? 'success' : 'failed'

      // 先推「完成」再落库：这样落库的 stagePoints 里也带着最后这一帧
      if (succeeded) {
        emitProgress(parser.markPhase('done'), true)
      }
      const updated = updateBuildRun(runRow.id, {
        state,
        exitCode: result.exitCode,
        logPath: result.logPath,
        apkPath: copiedPath ?? artifact?.apkPath ?? null,
        // 存实际落盘的文件名：重名时会加时间戳后缀，界面显示的名字要和磁盘上一致
        apkName: copiedPath ? basename(copiedPath) : (artifact?.apkName ?? null),
        applicationId: artifact?.applicationId ?? null,
        versionName: artifact?.versionName ?? null,
        versionCode: artifact?.versionCode ?? null,
        signed: signature ? signature.signed : (artifact?.signed ?? null),
        failureKind: classification?.kind ?? null,
        failureHint: hint,
        // 阶段序列跟着结果一起落库：历史记录也能「只看关键节点」，不依赖日志文件
        stagePoints: JSON.stringify(parser.snapshot().stages),
        finishedAt: new Date()
      })
      // 成功才算样本：失败/取消大多提前退出，混进统计会把预估拉低。
      // 写进独立的 variant_stats，而不是等界面去翻 build_runs —— 用户清空队列记录
      // 会把 build_runs 一起删掉，那之后进度条就再也算不出预估了。
      if (succeeded && updated !== null && updated.finishedAt !== null) {
        recordVariantDuration({
          projectId: project.id,
          variant,
          durationMs: updated.finishedAt.getTime() - updated.startedAt.getTime(),
          endedAt: updated.finishedAt,
          sourceRunId: runRow.id
        })
      }
      // 跑完也要广播：队列项那行要显示这个变体的最终状态与耗时
      broadcastItem(itemId)

      if (updated) {
        broadcast(IPC_CHANNELS.BUILD.STATE, {
          runId: runRow.id,
          projectId: project.id,
          variant,
          state,
          run: toBuildRunDto(updated, project.id)
        })
      }

      logger.info('变体构建结束', {
        itemId,
        variant,
        state,
        exitCode: result.exitCode,
        durationMs: result.durationMs
      })

      if (canceled) {
        anyCanceled = true
        break
      }
      if (!succeeded) {
        anyFailed = true
      }
    }

    if (anyCanceled) {
      return finish(itemId, 'canceled', '用户取消')
    }
    if (anyFailed) {
      return finish(itemId, 'failed', '至少一个变体构建失败')
    }
    return finish(itemId, 'success', null)
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('执行队列项失败', { itemId, error: message })
    return finish(itemId, 'failed', `执行出错：${message}`)
  } finally {
    releaseRunning(itemId)
  }
}

function finish(itemId: string, state: QueueItemState, note: string | null): QueueItemState {
  updateItem(itemId, { state, note, finishedAt: new Date() })
  broadcastItem(itemId)
  announceFinished(itemId, state, note)
  return state
}

/** 一条队列项跑完就发系统通知：构建动辄几分钟，用户多半已经切走了 */
function announceFinished(itemId: string, state: QueueItemState, note: string | null): void {
  const row = findItemRow(itemId)
  if (!row) {
    return
  }

  const project = findProjectRow(row.projectId)
  const runs = listRunsForItem(itemId)
  const succeeded = runs.filter((run) => run.state === 'success').length
  const failed = runs.filter((run) => run.state === 'failed').length
  const projectName = project?.name ?? '项目'

  const title =
    state === 'success'
      ? `${projectName} 构建完成`
      : state === 'canceled'
        ? `${projectName} 构建已取消`
        : `${projectName} 构建失败`

  const parts = [`变体 ${runs.length}：成功 ${succeeded}`, `失败 ${failed}`]
  if (note) {
    parts.push(note)
  }

  notifyBuildFinished({ title, body: parts.join(' · ') })
}

export function broadcastItem(itemId: string): void {
  const row = findItemRow(itemId)
  if (!row) {
    return
  }
  broadcastItemDto(toQueueItemDto(row))
}

/**
 * 直接广播已经构造好的 DTO。
 *
 * 入队时要既广播又把它作为返回值，两处各构造一次就会多算一遍估值查询，
 * 还可能出现「广播里一个样、响应里另一个样」。给一条现成的 DTO 复用。
 */
export function broadcastItemDto(item: QueueItem): void {
  broadcast(IPC_CHANNELS.QUEUE.STATE, { item })
}

function broadcastRunState(
  projectId: string,
  variant: string,
  runId: string,
  state: BuildRunState
): void {
  const row = getBuildRun(runId)
  if (!row) {
    return
  }
  broadcast(IPC_CHANNELS.BUILD.STATE, {
    runId,
    projectId,
    variant,
    state,
    run: toBuildRunDto(row, projectId)
  })
}
