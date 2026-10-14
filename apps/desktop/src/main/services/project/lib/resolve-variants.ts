import { app } from 'electron'
import { locateGradlew } from '../../../lib/gradle-paths'
import { logger as baseLogger } from '../../logger'
import { computeSignature } from './cache'
import { probeVariantsViaGradle, extractFailureHint } from './gradle-fallback'
import { parseProjectStatics, toProjectVariants } from './parse-gradle'
import type { StaticParseResult } from './parse-gradle'
import type { ProjectVariant } from '../types'

const logger = baseLogger.scope('project:variants')

export interface ResolveVariantsOptions {
  projectPath: string
  /** true 时跳过静态解析，直接跑 Gradle */
  forceGradle?: boolean
  /** 允许跑 Gradle 回退（添加项目时可以关掉，避免让用户干等） */
  allowGradleFallback?: boolean
}

export interface ResolveVariantsOutcome {
  appModule: string | null
  variants: ProjectVariant[]
  source: 'static' | 'gradle'
  signature: string | null
  limitations: string[]
  /** 回退失败时的可读原因（Gradle 报错片段或超时说明） */
  gradleFailureHint: string | null
}

/**
 * 两级解析：静态优先，不可信或用户要求时回退跑 Gradle。
 * 结果一律带 source，界面据此提示「静态结果可能缺项」。
 */
export async function resolveVariants(options: ResolveVariantsOptions): Promise<ResolveVariantsOutcome> {
  const staticResult = parseProjectStatics(options.projectPath)
  const signature = computeSignature(staticResult.readFiles)

  if (!options.forceGradle && staticResult.ok) {
    return {
      appModule: staticResult.appModules[0] ?? null,
      variants: toProjectVariants(staticResult, 'static'),
      source: 'static',
      signature,
      limitations: staticResult.limitations,
      gradleFailureHint: null
    }
  }

  if (options.allowGradleFallback === false) {
    return {
      appModule: staticResult.appModules[0] ?? null,
      variants: toProjectVariants(staticResult, 'static'),
      source: 'static',
      signature,
      limitations: [
        ...staticResult.limitations,
        '这次没有跑 Gradle 兜底，变体列表可能不完整；可以点「刷新变体」强制解析'
      ],
      gradleFailureHint: null
    }
  }

  const gradlewPath = locateGradlew(options.projectPath)
  if (!gradlewPath) {
    return {
      appModule: staticResult.appModules[0] ?? null,
      variants: toProjectVariants(staticResult, 'static'),
      source: 'static',
      signature,
      limitations: [...staticResult.limitations, '项目根目录没有 gradlew，无法用 Gradle 兜底解析变体'],
      gradleFailureHint: null
    }
  }

  logger.info('回退跑 Gradle 解析变体', { projectPath: options.projectPath, gradlewPath })
  const probed = await probeVariantsViaGradle({
    projectPath: options.projectPath,
    gradlewPath,
    probeDir: probeDir(),
    timeoutMs: 5 * 60 * 1000
  })

  if (probed.variants.length === 0) {
    const hint = probed.errorMessage ?? extractFailureHint(probed.stderr, probed.stdout)
    logger.warn('Gradle 兜底没拿到变体', {
      exitCode: probed.exitCode,
      timedOut: probed.timedOut,
      hint: hint ?? ''
    })
    return {
      appModule: staticResult.appModules[0] ?? null,
      variants: toProjectVariants(staticResult, 'static'),
      source: 'static',
      signature,
      limitations: [
        ...staticResult.limitations,
        'Gradle 兜底没有返回变体，下面仍是静态解析结果，可能不完整'
      ],
      gradleFailureHint: hint
    }
  }

  return {
    appModule: probed.appModules[0] ?? staticResult.appModules[0] ?? null,
    variants: probed.variants.map((variant) => ({ ...variant, source: 'gradle' as const })),
    source: 'gradle',
    signature: computeSignature([...staticResult.readFiles, ...signatureExtraFiles(staticResult)]),
    limitations: staticResult.limitations.filter((note) => !note.includes('读不出具体名字')),
    gradleFailureHint: null
  }
}

/**
 * 把 Gradle 失败片段并进 limitations，用户在界面上能直接看到原因。
 * 添加与刷新两条路径都要用，所以放这里而不是各自的 procedure 里。
 */
export function withFailureHint(outcome: ResolveVariantsOutcome): ResolveVariantsOutcome {
  if (!outcome.gradleFailureHint) {
    return outcome
  }
  return {
    ...outcome,
    limitations: [...outcome.limitations, `Gradle 输出：${outcome.gradleFailureHint}`]
  }
}

function signatureExtraFiles(staticResult: StaticParseResult): string[] {
  return staticResult.modules.map((module) => module.buildFile).filter((file): file is string => Boolean(file))
}

function probeDir(): string {
  return `${app.getPath('userData')}/gradle-probe`
}
