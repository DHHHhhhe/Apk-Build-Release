import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import { locateGradlew as locateGradlewIn } from '../../../lib/gradle-paths'
import type { EnvProbeItem, EnvProbeResult } from '@shared/types/env'

const execFileAsync = promisify(execFile)

const isWindows = process.platform === 'win32'

/**
 * 解析 Java properties 格式（local.properties / gradle.properties 都是这个格式）。
 * 只需要处理 SDK 与 JDK 路径相关的键，所以做最小实现：
 * 支持 `key=value` 与 `key:value`、`#` / `!` 注释、行尾续行，以及 `\\` 与 `\:` 转义。
 */
export function parsePropertiesFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!existsSync(filePath)) {
    return result
  }

  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return result
  }

  const logicalLines: string[] = []
  let buffer = ''
  for (const physicalLine of raw.split(/\r?\n/)) {
    const line = buffer + physicalLine
    if (/(?<!\\)(\\\\)*\\$/.test(line)) {
      // 行尾反斜杠表示续行
      buffer = line.slice(0, -1)
      continue
    }
    buffer = ''
    logicalLines.push(line)
  }

  for (const line of logicalLines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue
    }
    const separatorIndex = findSeparatorIndex(trimmed)
    if (separatorIndex < 0) {
      continue
    }
    const key = unescapeProperty(trimmed.slice(0, separatorIndex).trim())
    const value = unescapeProperty(trimmed.slice(separatorIndex + 1).trim())
    result[key] = value
  }

  return result
}

function findSeparatorIndex(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '=' || char === ':') {
      return index
    }
  }
  return -1
}

function unescapeProperty(value: string): string {
  return value.replace(/\\([:=#!\s\\])/g, '$1')
}

interface LocatedPath {
  value: string
  source: string
}

export type { LocatedPath }

/**
 * 按 AGP 的顺序定位 Android SDK：local.properties 的 sdk.dir → ANDROID_HOME → ANDROID_SDK_ROOT。
 * 冲突与不一致都放在 conflicts 里，调用方决定是警告还是忽略。
 */
export function locateAndroidSdk(projectPath?: string): {
  located: LocatedPath | null
  conflicts: string[]
} {
  const fromLocal = locateSdkFromLocalProperties(projectPath)
  const fromEnv = locateSdkFromEnv()
  const conflicts = [...fromEnv.conflicts]

  if (fromLocal && fromEnv.located && fromLocal.value !== fromEnv.located.value) {
    conflicts.push(
      `local.properties 的 sdk.dir（${fromLocal.value}）与 ${fromEnv.located.source}（${fromEnv.located.value}）不一致，Gradle 会用 sdk.dir`
    )
  }

  return { located: fromLocal ?? fromEnv.located, conflicts }
}

/** 项目里的 local.properties 的 sdk.dir（相对路径按项目根解析），与 AGP 的 SdkLocator 一致 */
function locateSdkFromLocalProperties(projectPath: string | undefined): LocatedPath | null {
  if (!projectPath) {
    return null
  }
  const properties = parsePropertiesFile(join(projectPath, 'local.properties'))
  const sdkDir = properties['sdk.dir']
  if (!sdkDir || sdkDir.trim() === '') {
    return null
  }
  return {
    value: toAbsolute(sdkDir, projectPath),
    source: 'local.properties 的 sdk.dir'
  }
}

function locateSdkFromEnv(): { located: LocatedPath | null; conflicts: string[] } {
  const candidates: Array<{ key: string; value: string | undefined }> = [
    { key: 'ANDROID_HOME', value: process.env['ANDROID_HOME'] },
    { key: 'ANDROID_SDK_ROOT', value: process.env['ANDROID_SDK_ROOT'] }
  ]

  const present = candidates.filter((item): item is { key: string; value: string } => {
    return typeof item.value === 'string' && item.value.trim() !== ''
  })

  if (present.length === 0) {
    return { located: null, conflicts: [] }
  }

  // AGP 的做法：多个来源都设了但指向不同目录时直接报错，这里降级为警告并把冲突说清楚
  const conflicts: string[] = []
  const distinct = new Set(present.map((item) => toAbsolute(item.value, undefined).toLowerCase()))
  if (distinct.size > 1) {
    const detail = present.map((item) => `${item.key}=${item.value}`).join('；')
    conflicts.push(`环境变量指向了不同的 SDK 目录（${detail}），Gradle 会因此报错，只保留一个`)
  }

  // 优先级：ANDROID_HOME 高于已废弃的 ANDROID_SDK_ROOT
  const preferred = present.find((item) => item.key === 'ANDROID_HOME') ?? present[0]
  if (!preferred) {
    return { located: null, conflicts }
  }

  return {
    located: {
      value: toAbsolute(preferred.value, undefined),
      source: `${preferred.key} 环境变量`
    },
    conflicts
  }
}

function locateJavaHome(projectPath: string | undefined): LocatedPath | null {
  if (projectPath) {
    const gradleProperties = parsePropertiesFile(join(projectPath, 'gradle.properties'))
    const javaHome = gradleProperties['org.gradle.java.home']
    if (javaHome && javaHome.trim() !== '') {
      return {
        value: toAbsolute(javaHome, projectPath),
        source: 'gradle.properties 的 org.gradle.java.home'
      }
    }
  }

  const envJavaHome = process.env['JAVA_HOME']
  if (envJavaHome && envJavaHome.trim() !== '') {
    return { value: toAbsolute(envJavaHome, undefined), source: 'JAVA_HOME 环境变量' }
  }

  return null
}

function locateGradlew(projectPath: string | undefined): string | null {
  if (!projectPath) {
    return null
  }
  return locateGradlewIn(projectPath)
}

/** 从 gradle/wrapper/gradle-wrapper.properties 里取 distributionUrl 的 Gradle 版本 */
export function readGradleWrapperVersion(projectPath: string): string | null {
  const properties = parsePropertiesFile(join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties'))
  const distributionUrl = properties['distributionUrl']
  if (!distributionUrl) {
    return null
  }
  const matched = /gradle-([0-9][^-]*)-/.exec(distributionUrl)
  return matched?.[1] ?? null
}

function toAbsolute(input: string, baseDir: string | undefined): string {
  const trimmed = input.trim()
  if (isAbsolutePath(trimmed) || !baseDir) {
    return resolvePath(trimmed)
  }
  return resolvePath(baseDir, trimmed)
}

function isAbsolutePath(value: string): boolean {
  if (isWindows) {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')
  }
  return value.startsWith('/')
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 判断目录像不像一个 Android SDK：至少要能看到平台或命令行工具 */
function looksLikeAndroidSdk(sdkDir: string): boolean {
  const markers = ['platform-tools', 'cmdline-tools', 'tools', 'platforms', 'build-tools', 'licenses']
  return markers.some((marker) => existsSync(join(sdkDir, marker)))
}

async function detectJavaVersion(javaHome: string): Promise<string | null> {
  const javaBin = join(javaHome, 'bin', isWindows ? 'java.exe' : 'java')
  if (!existsSync(javaBin)) {
    return null
  }
  try {
    // java -version 走 stderr
    const { stderr, stdout } = await execFileAsync(javaBin, ['-version'], { timeout: 10_000 })
    const output = `${stdout}${stderr}`
    const matched = /version "([^"]+)"/.exec(output)
    return matched?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * 探测本机构建环境。SDK 的查找顺序照抄 AGP 的 SdkLocator：
 * local.properties 的 sdk.dir → ANDROID_HOME / ANDROID_SDK_ROOT → 都没有则报缺。
 */
export async function collectEnvironment(projectPath?: string): Promise<EnvProbeResult> {
  const items: EnvProbeItem[] = []
  const warnings: string[] = []

  // ── Android SDK ──
  const { located: sdk, conflicts: sdkConflicts } = locateAndroidSdk(projectPath)
  warnings.push(...sdkConflicts)

  if (!sdk) {
    items.push({
      id: 'androidSdk',
      label: 'Android SDK',
      state: 'error',
      value: null,
      source: null,
      detail: '没找到：在项目 local.properties 里设 sdk.dir，或设置 ANDROID_HOME 环境变量'
    })
  } else if (!isDirectory(sdk.value)) {
    items.push({
      id: 'androidSdk',
      label: 'Android SDK',
      state: 'error',
      value: sdk.value,
      source: sdk.source,
      detail: '路径不是一个存在的目录'
    })
  } else if (!looksLikeAndroidSdk(sdk.value)) {
    items.push({
      id: 'androidSdk',
      label: 'Android SDK',
      state: 'warn',
      value: sdk.value,
      source: sdk.source,
      detail: '目录存在，但看不到 platform-tools / cmdline-tools / platforms，可能不是 SDK 根目录'
    })
  } else {
    items.push({
      id: 'androidSdk',
      label: 'Android SDK',
      state: 'ok',
      value: sdk.value,
      source: sdk.source,
      detail: null
    })
  }

  // ── JDK ──
  const javaHome = locateJavaHome(projectPath)
  if (!javaHome) {
    items.push({
      id: 'java',
      label: 'JDK',
      state: 'error',
      value: null,
      source: null,
      detail: '没找到：设置 JAVA_HOME，或在 gradle.properties 里指定 org.gradle.java.home'
    })
  } else if (!isDirectory(javaHome.value)) {
    items.push({
      id: 'java',
      label: 'JDK',
      state: 'error',
      value: javaHome.value,
      source: javaHome.source,
      detail: '路径不是一个存在的目录'
    })
  } else {
    const version = await detectJavaVersion(javaHome.value)
    if (!version) {
      items.push({
        id: 'java',
        label: 'JDK',
        state: 'warn',
        value: javaHome.value,
        source: javaHome.source,
        detail: '目录存在，但 bin 下没找到可执行的 java，或 java -version 执行失败'
      })
    } else {
      const major = Number.parseInt(version.split('.')[0] ?? '', 10)
      // AGP 8.x 起要求 JDK 17；AGP 7.x 可用 11，这里只提示不判定失败
      const state = Number.isFinite(major) && major < 17 ? 'warn' : 'ok'
      items.push({
        id: 'java',
        label: 'JDK',
        state,
        value: `${version}（${javaHome.value}）`,
        source: javaHome.source,
        detail:
          state === 'warn'
            ? 'JDK 低于 17，AGP 8.x 及以上的项目会直接失败；老项目（AGP 7.x）通常没问题'
            : null
      })
    }
  }

  // ── Gradle Wrapper ──
  const gradlew = locateGradlew(projectPath)
  if (!projectPath) {
    items.push({
      id: 'gradlew',
      label: 'Gradle Wrapper',
      state: 'warn',
      value: null,
      source: null,
      detail: '还没选项目目录，选好项目后再探测'
    })
  } else if (!gradlew) {
    items.push({
      id: 'gradlew',
      label: 'Gradle Wrapper',
      state: 'error',
      value: null,
      source: null,
      detail: '项目根目录下没有 gradlew / gradlew.bat，无法用项目自己的 Gradle 构建'
    })
  } else {
    const wrapperVersion = readGradleWrapperVersion(projectPath)
    items.push({
      id: 'gradlew',
      label: 'Gradle Wrapper',
      state: 'ok',
      value: wrapperVersion ? `${gradlew}（Gradle ${wrapperVersion}）` : gradlew,
      source: '项目目录',
      detail: null
    })
  }

  return {
    success: true,
    projectPath: projectPath ?? null,
    items,
    warnings,
    probedAt: Date.now()
  }
}
