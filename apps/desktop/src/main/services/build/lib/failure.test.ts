import { describe, expect, it } from 'vitest'
import { classifyFailure, extractGradleFailure } from './failure'

describe('classifyFailure', () => {
  it('超时优先于其他判定', () => {
    const result = classifyFailure({ exitCode: null, timedOut: true, output: 'Java heap space' })
    expect(result.kind).toBe('timeout')
  })

  it('识别 OOM 并给出可操作建议', () => {
    const result = classifyFailure({
      exitCode: 1,
      timedOut: false,
      output: 'FAILURE: Build failed with an exception\njava.lang.OutOfMemoryError: Java heap space'
    })
    expect(result.kind).toBe('oom')
    expect(result.hint).toContain('-Xmx')
  })

  it('识别缺少 SDK 组件', () => {
    const result = classifyFailure({
      exitCode: 1,
      timedOut: false,
      output: 'Failed to install the following Android SDK packages as some licences have not been accepted: platforms;android-34'
    })
    expect(result.kind).toBe('missing-sdk')
    expect(result.hint).toContain('sdkmanager')
  })

  it('识别 SDK 里缺对应 platform（Failed to find target with hash string）', () => {
    const result = classifyFailure({
      exitCode: 1,
      timedOut: false,
      output:
        "FAILURE: Build failed with an exception.\n* What went wrong:\nFailed to find target with hash string 'android-33' in: C:\\fake-sdk"
    })
    expect(result.kind).toBe('missing-sdk')
  })

  it('识别 JDK 版本不符', () => {
    const result = classifyFailure({
      exitCode: 1,
      timedOut: false,
      output: 'Unsupported class file major version 61'
    })
    expect(result.kind).toBe('java-version')
  })

  it('普通构建失败归到 gradle 并带上 What went wrong', () => {
    const result = classifyFailure({
      exitCode: 1,
      timedOut: false,
      output:
        '> Task :app:compileDebugKotlin FAILED\n\nFAILURE: Build failed with an exception.\n\n* What went wrong:\nExecution failed for task :app:compileDebugKotlin'
    })
    expect(result.kind).toBe('gradle')
    expect(result.hint).toContain('What went wrong')
  })

  it('认不出来时给 unknown 而不是硬猜', () => {
    const result = classifyFailure({ exitCode: 1, timedOut: false, output: 'something odd' })
    expect(result.kind).toBe('unknown')
    expect(result.hint).toBeNull()
  })

  it('退出码为 0 时不判失败', () => {
    const result = classifyFailure({ exitCode: 0, timedOut: false, output: 'BUILD SUCCESSFUL' })
    expect(result.kind).toBe('unknown')
    expect(result.hint).toBeNull()
  })
})

describe('extractGradleFailure', () => {
  it('优先截取 What went wrong 段', () => {
    const hint = extractGradleFailure(
      'FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not determine the dependencies of task :app:assembleFreeRelease'
    )
    expect(hint).toContain('Could not determine the dependencies')
  })

  it('没有标准段落时返回 null', () => {
    expect(extractGradleFailure('BUILD SUCCESSFUL')).toBeNull()
  })
})
