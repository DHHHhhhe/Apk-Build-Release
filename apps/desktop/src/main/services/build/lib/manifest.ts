import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('build:manifest')

export const MANIFEST_FILE_NAME = 'manifest.json'

export interface ManifestEntry {
  variant: string
  /** 实际落盘的文件名（重名时带时间戳后缀） */
  apkName: string
  apkPath: string
  signed: boolean | null
  copiedAt: number
}

export interface ManifestFile {
  updatedAt: number
  /** 每个变体只留最新的一条 */
  artifacts: ManifestEntry[]
}

/**
 * 在归档目录里记一份 manifest，回答「这个渠道最新的包是哪一个」。
 *
 * 背景：产物同名时 `uniquePath` 会加时间戳后缀、**绝不覆盖**（PRD 风险表 D7 的缓解措施），
 * 于是同一渠道反复出包会在目录里堆好几个历史包，肉眼分不出该发哪个。
 * manifest 只记录每个变体**最新**的那一份，不删旧包、也不改目录结构 ——
 * 这样既不违背「不静默覆盖」，又给了一个确定的答案。
 *
 * 读不到或写不了都只记一行日志：包已经落在目录里了，manifest 只是附加信息。
 */
export function recordArtifact(folder: string, entry: ManifestEntry): void {
  try {
    const current = readManifest(folder)
    const others = (current?.artifacts ?? []).filter((item) => item.variant !== entry.variant)
    const next: ManifestFile = { updatedAt: Date.now(), artifacts: [...others, entry] }
    writeFileSync(join(folder, MANIFEST_FILE_NAME), JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('manifest 写入失败', { folder, error: message })
  }
}

export function readManifest(folder: string): ManifestFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, MANIFEST_FILE_NAME), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const record = parsed as Partial<ManifestFile>
    if (!Array.isArray(record.artifacts)) {
      return null
    }
    return {
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
      artifacts: record.artifacts as ManifestEntry[]
    }
  } catch {
    return null
  }
}
