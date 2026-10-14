import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extractFailureHint,
  normalizeProbeVariants,
  parseProbeOutput,
  VARIANT_PROBE_SCRIPT,
  writeProbeScript
} from './gradle-fallback'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-probe-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('parseProbeOutput', () => {
  it('解析 TOOL_VARIANT 行并推导 flavor 与 buildType', () => {
    const stdout = [
      'TOOL_VARIANT_HOOK::app:registered',
      'TOOL_VARIANT::app:demo_flavorDebug',
      'TOOL_VARIANT::app:demo_flavorRelease',
      'TOOL_VARIANT_END',
      'BUILD SUCCESSFUL in 11s'
    ].join('\n')

    const parsed = parseProbeOutput(stdout)
    expect(parsed.appModules).toEqual([':app'])
    expect(parsed.variants).toEqual([
      { name: 'demo_flavorDebug', flavor: null, buildType: 'debug' },
      { name: 'demo_flavorRelease', flavor: null, buildType: 'release' }
    ])
    expect(parsed.errors).toEqual([])
  })

  it('无 flavor 的变体不会误判出 flavor', () => {
    const parsed = parseProbeOutput('TOOL_VARIANT::app:Debug\nTOOL_VARIANT::app:Release\n')
    const normalized = normalizeProbeVariants(parsed.variants)
    expect(normalized).toEqual([
      { name: 'Debug', flavor: null, buildType: 'debug' },
      { name: 'Release', flavor: null, buildType: 'release' }
    ])
  })

  it('flavor 推导保留原始大小写', () => {
    const parsed = parseProbeOutput('TOOL_VARIANT::app:MooN_flavorRelease\n')
    const normalized = normalizeProbeVariants(parsed.variants)
    expect(normalized[0]?.flavor).toBe('MooN_flavor')
    expect(normalized[0]?.buildType).toBe('release')
  })

  it('收集脚本自身报的错', () => {
    const parsed = parseProbeOutput('TOOL_VARIANT_ERROR::app:java.lang.ClassNotFoundException:xxx\n')
    expect(parsed.errors).toEqual([':app:java.lang.ClassNotFoundException:xxx'])
    expect(parsed.variants).toEqual([])
  })

  it('忽略无关输出', () => {
    const parsed = parseProbeOutput('> Task :app:help\nBUILD SUCCESSFUL\n')
    expect(parsed.variants).toEqual([])
    expect(parsed.appModules).toEqual([])
  })
})

describe('writeProbeScript', () => {
  it('把探针脚本写到指定目录，且不引用 AGP 类', () => {
    const scriptPath = writeProbeScript(workspace)
    const content = readFileSync(scriptPath, 'utf8')
    expect(content).toBe(VARIANT_PROBE_SCRIPT)
    expect(content).toContain('androidComponents')
    expect(content).not.toContain('com.android.build.api.variant')
  })
})

describe('extractFailureHint', () => {
  it('挑出 SDK 未配置这类可读原因', () => {
    const stderr = 'FAILURE: Build failed with an exception.\n\n* What went wrong:\nSDK location not found. Define a valid SDK location'
    const hint = extractFailureHint(stderr, '')
    expect(hint).toContain('SDK location not found')
  })

  it('没有已知模式时返回 null', () => {
    expect(extractFailureHint('some random output', '')).toBeNull()
  })
})
