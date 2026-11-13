import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { resolveOutputFolderName, sanitizeSegment } from '@shared/lib/output-folder'
import { logger as baseLogger } from '../../logger'

const logger = baseLogger.scope('build:artifacts')

export interface ApkArtifact {
  apkPath: string
  apkName: string
  applicationId: string | null
  variantName: string | null
  versionCode: number | null
  versionName: string | null
  /** 只有文件名带 unsigned 时能确定是未签名；其余留给阶段 5 的 apksigner 校验 */
  signed: boolean | null
  /** 产物是怎么定位到的：metadata 表示读了 output-metadata.json，filename 表示按文件名退化 */
  matchedBy: 'metadata' | 'filename'
}

export interface FindArtifactsOptions {
  projectPath: string
  /** 模块目录（相对项目根）；为空时只扫项目根的 build/outputs */
  moduleDirs: string[]
  expectedVariant: string
}

/**
 * 找某个变体的 APK。
 * AGP 7.x 的布局是 outputs/apk/<flavor>/<buildType>/，AGP 8.x 起是 outputs/apk/<variant>/，
 * 所以一律递归找 output-metadata.json，不按变体名拼路径；测试产物目录（androidTest）要排除。
 */
export function findApkArtifacts(options: FindArtifactsOptions): ApkArtifact[] {
  const bases = [options.projectPath, ...options.moduleDirs.map((dir) => join(options.projectPath, dir))]
  const metadataFiles: string[] = []
  const apkFiles: string[] = []

  for (const base of bases) {
    const apkRoot = join(base, 'build', 'outputs', 'apk')
    if (!existsSync(apkRoot)) {
      continue
    }
    collectFiles(apkRoot, metadataFiles, apkFiles)
  }

  const expected = options.expectedVariant.toLowerCase()
  const fromMetadata: ApkArtifact[] = []

  for (const metadataPath of metadataFiles) {
    const parsed = readOutputMetadata(metadataPath)
    if (!parsed) {
      continue
    }
    if (parsed.variantName && parsed.variantName.toLowerCase() !== expected) {
      continue
    }
    const dir = join(metadataPath, '..')
    for (const element of parsed.elements) {
      if (!element.outputFile) {
        continue
      }
      const apkPath = join(dir, element.outputFile)
      if (!existsSync(apkPath)) {
        continue
      }
      fromMetadata.push({
        apkPath,
        apkName: element.outputFile,
        applicationId: parsed.applicationId,
        variantName: parsed.variantName,
        versionCode: element.versionCode,
        versionName: element.versionName,
        signed: inferSigned(element.outputFile),
        matchedBy: 'metadata'
      })
    }
  }

  if (fromMetadata.length > 0) {
    return fromMetadata
  }

  // 没有 output-metadata.json 时按文件名/路径退化匹配
  const fallback = apkFiles
    .filter((apkPath) => {
      const lower = apkPath.toLowerCase()
      const name = basename(apkPath).toLowerCase()
      return lower.includes(expected) || name.includes(expected)
    })
    .map<ApkArtifact>((apkPath) => ({
      apkPath,
      apkName: basename(apkPath),
      applicationId: null,
      variantName: null,
      versionCode: null,
      versionName: null,
      signed: inferSigned(apkPath),
      matchedBy: 'filename'
    }))

  if (fallback.length === 0) {
    logger.warn('没有找到该变体的 APK', {
      expectedVariant: options.expectedVariant,
      scannedMetadata: metadataFiles.length,
      scannedApk: apkFiles.length
    })
  }

  return fallback
}

export interface CopyArtifactOptions {
  /**
   * 清空输出目录里除本次产物以外的一切（设置里的「新增 APK 覆盖原有包体」）。
   *
   * 不能只判同名：很多工程在 Gradle 里把构建时间戳拼进了 outputFileName
   * （例如 `appName_V1.5.0_20261112_1746.apk`），每次构建文件名都不同，
   * 只按同名判断就永远不会命中，输出目录里会越堆越多。
   *
   * 默认 false：重名加时间戳后缀、历史包都留着。
   */
  overwrite?: boolean
  /**
   * 本次构建（同一条队列项）已经产出的文件名，清理时要一并保留。
   *
   * 目录是按项目别名分的，debug 与 release 共用同一个目录：没有这份清单的话，
   * 同一批里先构建的 debug 包会被后构建的 release 包顺手删掉。
   */
  keep?: ReadonlySet<string>
}

/** 复制到统一输出目录：按项目分子目录、保留原名 */
export function copyArtifactToOutput(
  artifact: ApkArtifact,
  outputRoot: string,
  projectName: string,
  options: CopyArtifactOptions = {}
): string {
  const targetDir = join(outputRoot, sanitizeSegment(projectName))
  mkdirSync(targetDir, { recursive: true })

  const overwritten = options.overwrite === true
  const target = overwritten ? join(targetDir, artifact.apkName) : uniquePath(targetDir, artifact.apkName)

  // 输出目录被设成项目自己的 build/outputs 时，源和目标会是同一个文件：
  // 此时 copyFileSync 会先截断目标（也就是源），把刚打出来的包清成 0 字节。
  if (resolve(artifact.apkPath) === resolve(target)) {
    logger.info('产物已在输出目录内，跳过复制', { path: target })
    return target
  }

  // 清理清单 = 本次构建已产出的文件 + 正在写的这一个
  const keep = new Set<string>(options.keep ?? [])
  keep.add(basename(target))

  if (overwritten && existsSync(target)) {
    // 覆盖走「同目录临时文件 + 改名」：直接 copy 到目标会先截断旧包，
    // 复制中途失败（磁盘满、源文件被占用）就只剩一个残缺的 APK，比不覆盖更糟。
    // rename 在同一个目录内是原子的，要么是旧包、要么是完整新包。
    const temp = `${target}.tmp-${process.pid}`
    try {
      copyFileSync(artifact.apkPath, temp)
      renameSync(temp, target)
    } catch (error) {
      rmSync(temp, { force: true })
      throw error
    }
    logger.info('产物已覆盖', { from: artifact.apkPath, to: target })
    pruneAfterCopy(targetDir, keep)
    return target
  }

  copyFileSync(artifact.apkPath, target)
  logger.info('产物已复制', { from: artifact.apkPath, to: target })

  // 新包已经完整落盘，再清理目录里其余的东西 —— 顺序不能反：
  // 先删后复制的话，复制失败就会连旧包一起没了。
  if (overwritten) {
    pruneAfterCopy(targetDir, keep)
  }
  return target
}

/** 清空目录里不在保留清单内的东西并记日志；失败不影响本次构建（新包已经落地） */
function pruneAfterCopy(dir: string, keep: ReadonlySet<string>): void {
  const removed = pruneVariantDir(dir, keep)
  if (removed.length > 0) {
    logger.info('已清空输出目录里的其余内容', { count: removed.length, items: removed })
  }
}

/**
 * 文件名里的构建时间戳片段，例如 `_20261112_1746`、`_20261022-103600`、`_2026_11_12_17_46`。
 *
 * 只认「看起来像日期时间」的尾部：年月日与时分都要在合法范围，避免把
 * `报告_20261399_0000.apk` 这种真正的名字当成时间戳。
 */
const BUILD_STAMP_PATTERN = /[_-](\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(?:\d{2})?$/

/**
 * 从文件名里剥掉末尾的构建时间戳，得到「同一变体的产物族」标识。
 *
 * 同一个变体反复构建时，只有时间戳在变，前缀是稳定的；
 * 而 debug 与 release 的前缀不同（Gradle 里常给 debug 追加 `_debug包`），
 * 所以按前缀归族既能清掉历史包，又不会把另一个变体的包一起删掉。
 */
export function artifactFamilyKey(fileName: string): string {
  const withoutExt = fileName.replace(/\.apk$/i, '')
  const match = BUILD_STAMP_PATTERN.exec(withoutExt)
  if (!match) {
    return withoutExt
  }
  const [, year, month, day, hour, minute] = match
  const inRange =
    Number(month) >= 1 && Number(month) <= 12 &&
    Number(day) >= 1 && Number(day) <= 31 &&
    Number(hour) <= 23 && Number(minute) <= 59
  if (!inRange) {
    return withoutExt
  }
  // year 只用于占位，剥掉的是整个时间戳片段
  void year
  return withoutExt.slice(0, match.index)
}

/**
 * 清空变体目录里除了保留清单以外的一切。
 *
 * 目录当成本次构建的镜像，而不是越堆越多的仓库 —— 用户的诉求就是
 * 「先清空变体目录，再写入新产物」，所以这里不做人工挑选：
 * - 历史 APK：删
 * - 子文件夹（例如多渠道打包的 `渠道包/官方.apk`、`渠道包/快手.apk`）：整体递归删
 * - 非 APK 普通文件（说明文档、日志等）：删
 *
 * 保留清单由调用方给出：本次构建（同一条队列项）已经产出的文件名 + 正在写的这一个。
 * 同一批里 debug 与 release 共用同一个项目目录，没有这份清单就会互相删。
 *
 * 删不掉（被占用 / 只读）只记警告、跳过，不影响本次构建 —— 新包已经写好了。
 * 返回被删掉的名字（文件夹带 `/` 后缀），供日志与测试核对。
 */
export function pruneVariantDir(dir: string, keep: ReadonlySet<string>): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (keep.has(entry.name)) {
      continue
    }

    // 复制过程中的临时文件属于自己，清掉不算用户内容
    if (entry.isDirectory()) {
      try {
        rmSync(join(dir, entry.name), { recursive: true, force: true })
        removed.push(`${entry.name}/`)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        logger.warn('清理子文件夹失败，已跳过', { dir: entry.name, error: message })
      }
      continue
    }

    try {
      rmSync(join(dir, entry.name), { force: true })
      removed.push(entry.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      logger.warn('清理文件失败，已跳过', { file: entry.name, error: message })
    }
  }
  return removed
}

/**
 * 只删掉与 keepFileName 属于同一变体的历史 APK，保留其他文件。
 *
 * 用于「不清空目录、只想清同族历史包」的调用方与既有测试；
 * 覆盖模式走的是 pruneVariantDir（清空目录）。
 *
 * @deprecated 覆盖模式已改为清空整个目录，见 pruneVariantDir
 */
export function pruneVariantHistory(dir: string, keepFileName: string): string[] {
  const keepKey = artifactFamilyKey(keepFileName)
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    if (entry.name === keepFileName) {
      continue
    }

    // 子文件夹整体删：多渠道打包的输出目录每次都是全量重出的，旧的没有保留价值
    if (entry.isDirectory()) {
      try {
        rmSync(join(dir, entry.name), { recursive: true, force: true })
        removed.push(`${entry.name}/`)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        logger.warn('清理子文件夹失败，已跳过', { dir: entry.name, error: message })
      }
      continue
    }

    if (!entry.name.toLowerCase().endsWith('.apk')) {
      continue
    }
    if (artifactFamilyKey(entry.name) !== keepKey) {
      continue
    }
    try {
      rmSync(join(dir, entry.name), { force: true })
      removed.push(entry.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      logger.warn('清理历史产物失败，已跳过', { file: entry.name, error: message })
    }
  }
  return removed
}

/** 重名用时间戳后缀，比「(2)」更能说明哪个是新的；极端情况下再补序号 */
function uniquePath(dir: string, fileName: string): string {
  const first = join(dir, fileName)
  if (!existsSync(first)) {
    return first
  }

  const dotIndex = fileName.lastIndexOf('.')
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  const ext = dotIndex > 0 ? fileName.slice(dotIndex) : ''
  const stamp = formatStamp(new Date())

  let candidate = join(dir, `${stem}_${stamp}${ext}`)
  let index = 2
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}_${stamp}-${index}${ext}`)
    index += 1
  }
  return candidate
}

function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

function collectFiles(dir: string, metadataFiles: string[], apkFiles: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    let isDirectory = false
    try {
      isDirectory = statSync(fullPath).isDirectory()
    } catch {
      continue
    }

    if (isDirectory) {
      // 测试产物不算交付物
      if (/androidtest/i.test(entry)) {
        continue
      }
      collectFiles(fullPath, metadataFiles, apkFiles)
      continue
    }

    if (entry === 'output-metadata.json') {
      metadataFiles.push(fullPath)
      continue
    }
    if (entry.toLowerCase().endsWith('.apk')) {
      apkFiles.push(fullPath)
    }
  }
}

interface OutputMetadata {
  applicationId: string | null
  variantName: string | null
  elements: Array<{ outputFile: string | null; versionCode: number | null; versionName: string | null }>
}

export function readOutputMetadata(metadataPath: string): OutputMetadata | null {
  try {
    const raw = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
    const elements = Array.isArray(raw['elements']) ? raw['elements'] : []
    return {
      applicationId: typeof raw['applicationId'] === 'string' ? raw['applicationId'] : null,
      variantName: typeof raw['variantName'] === 'string' ? raw['variantName'] : null,
      elements: elements.map((element) => {
        const record = (element ?? {}) as Record<string, unknown>
        return {
          outputFile: typeof record['outputFile'] === 'string' ? record['outputFile'] : null,
          versionCode: typeof record['versionCode'] === 'number' ? record['versionCode'] : null,
          versionName: typeof record['versionName'] === 'string' ? record['versionName'] : null
        }
      })
    }
  } catch {
    return null
  }
}

function inferSigned(fileName: string): boolean | null {
  return /unsigned/i.test(fileName) ? false : null
}

export function describeArtifactLocation(artifact: ApkArtifact, projectPath: string): string {
  return relative(projectPath, artifact.apkPath)
}

/*
 * 归档文件夹名的规则在 shared/lib/output-folder —— 界面也要用它做「产物会落到哪」的预览，
 * 两份实现必然会走散。这里只做转出：现有调用方与测试仍然从本模块导入这两个名字。
 */
export { resolveOutputFolderName, sanitizeSegment }