import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { BuildRunState } from '@shared/types/build'
import type { QueueItemState } from '@shared/types/queue'
import { broadcast } from '../../../lib/broadcast'
import { locateGradlew } from '../../../lib/gradle-paths'
import { logger as baseLogger } from '../../logger'
import { copyArtifactToOutput, findApkArtifacts } from '../../build/lib/artifacts'
import { classifyFailure } from '../../build/lib/failure'
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

const logger = baseLogger.scope('queue:executor')

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
        }
      })

      const canceled = isCancelRequested(itemId)
      const succeeded = !canceled && !result.timedOut && result.exitCode === 0

      const artifact = succeeded
        ? (findApkArtifacts({ projectPath: project.path, moduleDirs, expectedVariant: variant })[0] ?? null)
        : null
      const copiedPath = artifact ? copyArtifactToOutput(artifact, outputRoot, project.name) : null

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
        finishedAt: new Date()
      })

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
  broadcast(IPC_CHANNELS.QUEUE.STATE, { item: toQueueItemDto(row) })
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
