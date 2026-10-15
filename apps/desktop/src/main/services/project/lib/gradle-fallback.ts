import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { planSpawn } from '../../../lib/gradle-paths'
import { killProcessTree } from '../../build/lib/spawn-gradle'
import type { StaticVariant } from './parse-gradle'

// 回退路径：不修改用户项目，用 --init-script 在配置阶段打印变体名。
// 脚本内容与阶段 0.5 实测通过的探针一致（research/tool-variant-probe.init.gradle）。

export const VARIANT_PROBE_FILE_NAME = 'tool-variant-probe.init.gradle'

export const VARIANT_PROBE_SCRIPT = `// 由 APK批量打包工具生成，只读：不改动项目，仅在配置阶段打印变体名
allprojects { p ->
    p.plugins.withId('com.android.application') {
        def ext = p.extensions.findByName('androidComponents')
        if (ext == null) {
            println "TOOL_VARIANT_ERROR:\${p.path}:androidComponents 扩展不存在"
            return
        }
        try {
            ext.onVariants(ext.selector().all(), { v ->
                println "TOOL_VARIANT:\${p.path}:\${v.name}"
            })
        } catch (Throwable t) {
            println "TOOL_VARIANT_ERROR:\${p.path}:\${t.class.name}:\${t.message}"
        }
    }
}
gradle.projectsEvaluated {
    println "TOOL_VARIANT_END"
}
`

export interface GradleProbeOptions {
  /** 项目根目录 */
  projectPath: string
  /** 项目里的 gradlew（gradlew.bat / gradlew） */
  gradlewPath: string
  /** 探针脚本落盘目录（userData 下），不写进用户项目 */
  probeDir: string
  timeoutMs?: number
}

export interface GradleProbeResult {
  variants: StaticVariant[]
  /** 变体所属的 Gradle 项目路径，例如 :app */
  appModules: string[]
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  errorMessage: string | null
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export function writeProbeScript(probeDir: string): string {
  mkdirSync(probeDir, { recursive: true })
  const probePath = join(probeDir, VARIANT_PROBE_FILE_NAME)
  writeFileSync(probePath, VARIANT_PROBE_SCRIPT, 'utf8')
  return probePath
}

/** 解析探针输出里的 TOOL_VARIANT 行 */
export function parseProbeOutput(stdout: string): { variants: StaticVariant[]; appModules: string[]; errors: string[] } {
  const variants: StaticVariant[] = []
  const appModules = new Set<string>()
  const errors: string[] = []

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('TOOL_VARIANT_ERROR:')) {
      errors.push(line.slice('TOOL_VARIANT_ERROR:'.length))
      continue
    }
    if (!line.startsWith('TOOL_VARIANT:')) {
      continue
    }
    const payload = line.slice('TOOL_VARIANT:'.length)
    const lastColon = payload.lastIndexOf(':')
    if (lastColon <= 0) {
      continue
    }
    const modulePath = payload.slice(0, lastColon)
    const variantName = payload.slice(lastColon + 1)
    if (!modulePath || !variantName) {
      continue
    }
    appModules.add(modulePath)
    variants.push({
      name: variantName,
      flavor: null,
      buildType: deriveBuildType(variantName)
    })
  }

  return { variants, appModules: Array.from(appModules), errors }
}

/** 变体名形如 demo_flavorDebug / debug，去掉尾部的 buildType 才是 flavor */
function deriveBuildType(variantName: string): string {
  const lower = variantName.toLowerCase()
  for (const buildType of ['debug', 'release']) {
    if (lower.endsWith(buildType)) {
      return buildType
    }
  }
  return variantName
}

function deriveFlavor(variantName: string, buildType: string): string | null {
  if (buildType === variantName) {
    return null
  }
  const flavor = variantName.slice(0, variantName.length - buildType.length)
  return flavor === '' ? null : flavor
}

export function normalizeProbeVariants(variants: StaticVariant[]): StaticVariant[] {
  return variants.map((variant) => ({
    name: variant.name,
    flavor: deriveFlavor(variant.name, variant.buildType),
    buildType: variant.buildType
  }))
}

/** 跑一次 Gradle 配置阶段拿变体；失败或超时都返回结构化结果而不是抛异常 */
export function probeVariantsViaGradle(options: GradleProbeOptions): Promise<GradleProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const probePath = writeProbeScript(options.probeDir)

  return new Promise<GradleProbeResult>((resolve) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    let settled = false
    let timedOut = false

    const plan = planSpawn(
      options.gradlewPath,
      ['--init-script', probePath, 'help', '--console=plain'],
      options.projectPath
    )
    const child = spawn(plan.command, plan.args, plan.options)

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child.pid)
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'))
    })

    child.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        variants: [],
        appModules: [],
        exitCode: null,
        timedOut: false,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        errorMessage: error.message
      })
    })

    child.on('close', (exitCode) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      const stdout = stdoutChunks.join('')
      const stderr = stderrChunks.join('')
      const parsed = parseProbeOutput(stdout)
      resolve({
        variants: normalizeProbeVariants(parsed.variants),
        appModules: parsed.appModules,
        exitCode,
        timedOut,
        stdout,
        stderr,
        errorMessage: timedOut
          ? `Gradle 在 ${Math.round(timeoutMs / 1000)} 秒内没有返回`
          : (parsed.errors[0] ?? null)
      })
    })
  })
}



/** 从探针输出里挑出最有用的失败片段，给用户看的是原因不是整段日志 */
export function extractFailureHint(stderr: string, stdout: string): string | null {
  const combined = `${stderr}\n${stdout}`
  const patterns = [
    /FAILURE: Build failed with an exception[\s\S]{0,600}/,
    /Could not resolve all files for configuration[\s\S]{0,300}/,
    /SDK location not found[\s\S]{0,200}/,
    /Unsupported class file major version[\s\S]{0,200}/,
    /Could not determine the dependencies of task[\s\S]{0,200}/
  ]
  for (const pattern of patterns) {
    const matched = pattern.exec(combined)
    if (matched) {
      return matched[0].trim().slice(0, 600)
    }
  }
  return null
}

export function probeDirFor(userDataDir: string): string {
  return join(userDataDir, 'gradle-probe')
}

export function probeScriptPath(userDataDir: string): string {
  return join(probeDirFor(userDataDir), VARIANT_PROBE_FILE_NAME)
}

export function ensureProbeDir(userDataDir: string): string {
  const dir = probeDirFor(userDataDir)
  mkdirSync(dirname(join(dir, 'x')), { recursive: true })
  return dir
}
