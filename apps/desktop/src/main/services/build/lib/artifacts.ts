import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
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

/** 复制到统一输出目录：按项目分子目录、保留原名，重名时加时间戳后缀，绝不静默覆盖 */
export function copyArtifactToOutput(
  artifact: ApkArtifact,
  outputRoot: string,
  projectName: string
): string {
  const targetDir = join(outputRoot, sanitizeSegment(projectName))
  mkdirSync(targetDir, { recursive: true })

  const target = uniquePath(targetDir, artifact.apkName)
  copyFileSync(artifact.apkPath, target)
  logger.info('产物已复制', { from: artifact.apkPath, to: target })
  return target
}

export function sanitizeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
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

/**
 * 输出目录下的子文件夹名：**优先用别名**。
 *
 * 同一个模板工程常常按渠道分发成好几个 App，别名就是分发名；按别名归档，
 * 输出目录里一眼能看出哪个包属于哪个渠道，而不是一堆同名的模板工程目录。
 */
export function resolveOutputFolderName(project: { alias: string | null; name: string }): string {
  const alias = project.alias?.trim() ?? ''
  // 别名是用户随手填的，必须先挡住路径分隔符与「上一级」：否则 join 之后会跑出统一输出目录。
  // （项目名来自目录 basename，本来就没有分隔符；别名没有这个天然保证。）
  const flattenedAlias = alias.replace(/[\\/]+/g, '-').replace(/\.{2,}/g, '-').trim()
  const source = flattenedAlias.length > 0 ? flattenedAlias : project.name
  return sanitizeSegment(source)
}