import { envProbeInputSchema } from '@shared/types/env'
import type { EnvProbeResult } from '@shared/types/env'
import { logger as baseLogger } from '../../logger'
import { collectEnvironment } from '../lib/probe'

const logger = baseLogger.scope('env:probe')

/** 环境自检：输入校验失败按「输入错误」返回，探测失败按「外部依赖错误」返回（error-handling.md） */
export async function probeEnvironment(input: unknown): Promise<EnvProbeResult> {
  const parsed = envProbeInputSchema.safeParse(input ?? {})
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('，')
    logger.warn('环境自检入参不合法', { error: message })
    return {
      success: false,
      error: message,
      projectPath: null,
      items: [],
      warnings: [],
      probedAt: Date.now()
    }
  }

  try {
    const result = await collectEnvironment(parsed.data.projectPath)
    logger.info('环境自检完成', {
      projectPath: result.projectPath,
      states: result.items.map((item) => `${item.id}=${item.state}`).join(',')
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error('环境自检失败', { error: message })
    return {
      success: false,
      error: '环境探测失败',
      projectPath: parsed.data.projectPath ?? null,
      items: [],
      warnings: [],
      probedAt: Date.now()
    }
  }
}
