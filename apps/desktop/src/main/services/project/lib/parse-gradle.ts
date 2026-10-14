import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VariantSource } from '../types'

// 静态解析：只读 settings.gradle[.kts] 与各模块 build.gradle[.kts]，不跑 Gradle。
// 已知限制（与 androkit 记录的一致，见 design.md §5.2）：
//   - flavor 对 applicationId / versionName 的覆盖算不出来
//   - buildSrc / 变量驱动的 flavor 名字读不出来，这类要回退跑 Gradle
//   - buildTypes 缺失时按 debug / release 假定

export interface StaticModule {
  /** Gradle 项目路径，例如 :app */
  path: string
  /** 模块目录（相对项目根），根模块为空串 */
  dir: string
  buildFile: string | null
  plugin: 'application' | 'library' | 'other' | null
}

export interface StaticVariant {
  name: string
  flavor: string | null
  buildType: string
}

export interface StaticParseResult {
  /** 静态结果是否足够可信；false 时调用方应回退跑 Gradle */
  ok: boolean
  /** 参与缓存签名的文件 */
  readFiles: string[]
  modules: StaticModule[]
  appModules: string[]
  flavors: string[]
  flavorDimensions: string[]
  buildTypes: string[]
  variants: StaticVariant[]
  limitations: string[]
}

const ASSUMED_BUILD_TYPES = ['debug', 'release']

export function parseProjectStatics(projectPath: string): StaticParseResult {
  const readFiles: string[] = []
  const limitations: string[] = []

  const settingsFile = firstExisting(projectPath, ['settings.gradle.kts', 'settings.gradle'])
  if (!settingsFile) {
    return {
      ok: false,
      readFiles,
      modules: [],
      appModules: [],
      flavors: [],
      flavorDimensions: [],
      buildTypes: [],
      variants: [],
      limitations: ['项目根目录下没有 settings.gradle / settings.gradle.kts，无法确认它是 Gradle 工程']
    }
  }
  readFiles.push(settingsFile)
  const settingsSource = readFileSafe(settingsFile)

  const modulePaths = extractIncludes(settingsSource)
  if (modulePaths.length === 0) {
    limitations.push('settings 文件里没解析到 include，模块列表可能不完整')
  }

  const modules: StaticModule[] = modulePaths.map((modulePath) => {
    const dir = modulePath.replace(/^:/, '').replace(/:/g, '/')
    const buildFile = firstExisting(join(projectPath, dir), ['build.gradle.kts', 'build.gradle'])
    if (buildFile) {
      readFiles.push(buildFile)
    }
    const source = buildFile ? readFileSafe(buildFile) : ''
    return {
      path: modulePath,
      dir,
      buildFile,
      plugin: detectPlugin(source)
    }
  })

  const appModules = modules.filter((module) => module.plugin === 'application').map((module) => module.path)
  const appModule = modules.find((module) => module.plugin === 'application')

  if (appModules.length === 0) {
    limitations.push('没找到应用了 com.android.application 的模块，变体列表无法静态确定')
    return {
      ok: false,
      readFiles,
      modules,
      appModules,
      flavors: [],
      flavorDimensions: [],
      buildTypes: [],
      variants: [],
      limitations
    }
  }

  if (appModules.length > 1) {
    limitations.push(`有多个 application 模块（${appModules.join('、')}），静态解析只按第一个模块取变体`)
  }

  const appSource = appModule?.buildFile ? readFileSafe(appModule.buildFile) : ''
  const flavorBlock = extractBlockBody(appSource, /productFlavors\s*\{/)
  const buildTypeBlock = extractBlockBody(appSource, /buildTypes\s*\{/)

  const flavors = flavorBlock ? extractDeclaredNames(flavorBlock) : []
  const flavorDimensions = extractFlavorDimensions(appSource)
  const detectedBuildTypes = buildTypeBlock ? extractDeclaredNames(buildTypeBlock) : []

  if (flavorBlock && flavors.length === 0) {
    limitations.push('productFlavors 块存在但读不出具体名字（可能是变量或循环生成），需要跑一次 Gradle')
  }

  let buildTypes = detectedBuildTypes
  if (buildTypes.length === 0) {
    buildTypes = ASSUMED_BUILD_TYPES
    limitations.push('没读到 buildTypes，按 Android 默认的 debug / release 假定')
  }

  const variants: StaticVariant[] = []
  if (flavors.length === 0) {
    for (const buildType of buildTypes) {
      variants.push({ name: capitalizeFirst(buildType), flavor: null, buildType })
    }
  } else {
    for (const flavor of flavors) {
      for (const buildType of buildTypes) {
        variants.push({
          name: `${flavor}${capitalizeFirst(buildType)}`,
          flavor,
          buildType
        })
      }
    }
    limitations.push('变体名由 flavor + buildType 拼接；flavor 对 applicationId / 版本号的覆盖要到构建后才能从产物确认')
  }

  const ok = variants.length > 0 && !(flavorBlock !== null && flavors.length === 0)

  return {
    ok,
    readFiles,
    modules,
    appModules,
    flavors,
    flavorDimensions,
    buildTypes,
    variants,
    limitations
  }
}

export function toProjectVariants(result: StaticParseResult, source: VariantSource): Array<{
  name: string
  flavor: string | null
  buildType: string
  source: VariantSource
}> {
  return result.variants.map((variant) => ({
    name: variant.name,
    flavor: variant.flavor,
    buildType: variant.buildType,
    source
  }))
}

function firstExisting(baseDir: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const fullPath = join(baseDir, candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }
  return null
}

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

/** 从 settings 文件里取 include 的模块路径，兼容 Groovy 与 Kotlin DSL */
export function extractIncludes(source: string): string[] {
  const withoutComments = stripComments(source)
  const result: string[] = []
  const includeCallPattern = /include\s*\(?([^\n)]*)/g

  let match = includeCallPattern.exec(withoutComments)
  while (match !== null) {
    const argumentText = match[1] ?? ''
    const quoted = /['"]([^'"]+)['"]/g
    let quotedMatch = quoted.exec(argumentText)
    while (quotedMatch !== null) {
      const value = quotedMatch[1]
      if (value && value.startsWith(':')) {
        result.push(value)
      }
      quotedMatch = quoted.exec(argumentText)
    }
    match = includeCallPattern.exec(withoutComments)
  }

  return Array.from(new Set(result))
}

function detectPlugin(source: string): StaticModule['plugin'] {
  if (source.includes('com.android.application')) {
    return 'application'
  }
  if (source.includes('com.android.library')) {
    return 'library'
  }
  return 'other'
}

/** 取 `xxx { ... }` 的块体，处理嵌套花括号、字符串与注释 */
export function extractBlockBody(source: string, headerPattern: RegExp): string | null {
  const withoutComments = stripComments(source)
  const header = headerPattern.exec(withoutComments)
  if (!header) {
    return null
  }

  const openIndex = withoutComments.indexOf('{', header.index + header[0].length - 1)
  if (openIndex < 0) {
    return null
  }

  let depth = 0
  for (let index = openIndex; index < withoutComments.length; index += 1) {
    const char = withoutComments[index]
    if (char === '"' || char === "'") {
      index = skipString(withoutComments, index)
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return withoutComments.slice(openIndex + 1, index)
      }
    }
  }

  return null
}

/** 取块体里在顶层声明的名字：`name { }`、`create("name") { }`、`getByName("name") { }` */
export function extractDeclaredNames(blockBody: string): string[] {
  const names: string[] = []
  const pattern =
    /(?:create|register|getByName|maybeCreate)\s*\(\s*["']([^"']+)["']\s*\)\s*\{|(?:^|[\s;])([A-Za-z_][A-Za-z0-9_]*)\s*\{/g

  let match = pattern.exec(blockBody)
  while (match !== null) {
    const name = match[1] ?? match[2]
    if (name && !RESERVED_BLOCK_NAMES.has(name)) {
      names.push(name)
    }
    match = pattern.exec(blockBody)
  }

  return Array.from(new Set(names))
}

const RESERVED_BLOCK_NAMES = new Set([
  'if',
  'else',
  'for',
  'while',
  'when',
  'switch',
  'return',
  'apply',
  'with',
  'also',
  'let',
  'run',
  'all',
  'each',
  'configureEach'
])

export function extractFlavorDimensions(source: string): string[] {
  const withoutComments = stripComments(source)
  const dimensions: string[] = []
  const pattern = /flavorDimensions\s*(?:\+?=|\+=)\s*(\[[^\]]*\]|["'][^"']+["'])/g

  let match = pattern.exec(withoutComments)
  while (match !== null) {
    const value = match[1] ?? ''
    const quoted = /["']([^"']+)["']/g
    let quotedMatch = quoted.exec(value)
    while (quotedMatch !== null) {
      if (quotedMatch[1]) {
        dimensions.push(quotedMatch[1])
      }
      quotedMatch = quoted.exec(value)
    }
    match = pattern.exec(withoutComments)
  }

  return Array.from(new Set(dimensions))
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function skipString(source: string, startIndex: number): number {
  const quote = source[startIndex]
  let index = startIndex + 1
  while (index < source.length) {
    const char = source[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      return index
    }
    index += 1
  }
  return source.length
}

function capitalizeFirst(value: string): string {
  if (value.length === 0) {
    return value
  }
  return value.charAt(0).toUpperCase() + value.slice(1)
}
