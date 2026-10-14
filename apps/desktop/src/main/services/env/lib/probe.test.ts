import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectEnvironment, parsePropertiesFile, readGradleWrapperVersion } from './probe'

let workspace: string

/** 造一个「像 SDK」的目录：只要有一个标记子目录即可 */
function createFakeSdk(parent: string, name: string): string {
  const sdkDir = join(parent, name)
  mkdirSync(join(sdkDir, 'platform-tools'), { recursive: true })
  return sdkDir
}

function createProject(parent: string, name: string, options: { gradlew?: boolean; localProperties?: string } = {}): string {
  const projectDir = join(parent, name)
  mkdirSync(projectDir, { recursive: true })
  if (options.gradlew !== false) {
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\n', 'utf8')
  }
  if (options.localProperties) {
    writeFileSync(join(projectDir, 'local.properties'), options.localProperties, 'utf8')
  }
  return projectDir
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-env-'))
  vi.stubEnv('ANDROID_HOME', '')
  vi.stubEnv('ANDROID_SDK_ROOT', '')
  vi.stubEnv('JAVA_HOME', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(workspace, { recursive: true, force: true })
})

describe('parsePropertiesFile', () => {
  it('处理 Java properties 的 Windows 路径转义', () => {
    const file = join(workspace, 'local.properties')
    writeFileSync(file, 'sdk.dir=C\\:\\\\Users\\\\demo\\\\AppData\\\\Local\\\\Android\\\\Sdk\n', 'utf8')
    expect(parsePropertiesFile(file)['sdk.dir']).toBe('C:\\Users\\demo\\AppData\\Local\\Android\\Sdk')
  })

  it('忽略注释与空行', () => {
    const file = join(workspace, 'gradle.properties')
    writeFileSync(file, '# 注释\n\norg.gradle.jvmargs=-Xmx2g\n', 'utf8')
    const parsed = parsePropertiesFile(file)
    expect(parsed['org.gradle.jvmargs']).toBe('-Xmx2g')
    expect(Object.keys(parsed)).toHaveLength(1)
  })
})

describe('readGradleWrapperVersion', () => {
  it('从 distributionUrl 里取版本号', () => {
    const projectDir = createProject(workspace, 'wrapper-project')
    mkdirSync(join(projectDir, 'gradle', 'wrapper'), { recursive: true })
    writeFileSync(
      join(projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-7.5-bin.zip\n',
      'utf8'
    )
    expect(readGradleWrapperVersion(projectDir)).toBe('7.5')
  })
})

describe('collectEnvironment', () => {
  it('local.properties 的 sdk.dir 优先于环境变量，并提示不一致', async () => {
    const localSdk = createFakeSdk(workspace, 'sdk-from-local')
    const envSdk = createFakeSdk(workspace, 'sdk-from-env')
    const projectDir = createProject(workspace, 'project-a', {
      localProperties: `sdk.dir=${localSdk.replace(/\\/g, '\\\\')}\n`
    })
    vi.stubEnv('ANDROID_HOME', envSdk)

    const result = await collectEnvironment(projectDir)
    const sdkItem = result.items.find((item) => item.id === 'androidSdk')

    expect(result.success).toBe(true)
    expect(sdkItem?.state).toBe('ok')
    expect(sdkItem?.value).toBe(localSdk)
    expect(sdkItem?.source).toContain('local.properties')
    expect(result.warnings.some((warning) => warning.includes('不一致'))).toBe(true)
  })

  it('没有 local.properties 时用 ANDROID_HOME', async () => {
    const envSdk = createFakeSdk(workspace, 'sdk-env-only')
    const projectDir = createProject(workspace, 'project-b')
    vi.stubEnv('ANDROID_HOME', envSdk)

    const result = await collectEnvironment(projectDir)
    const sdkItem = result.items.find((item) => item.id === 'androidSdk')

    expect(sdkItem?.state).toBe('ok')
    expect(sdkItem?.value).toBe(envSdk)
    expect(sdkItem?.source).toContain('ANDROID_HOME')
  })

  it('两个环境变量指向不同目录时给出警告', async () => {
    const projectDir = createProject(workspace, 'project-c')
    vi.stubEnv('ANDROID_HOME', createFakeSdk(workspace, 'sdk-conflict-a'))
    vi.stubEnv('ANDROID_SDK_ROOT', createFakeSdk(workspace, 'sdk-conflict-b'))

    const result = await collectEnvironment(projectDir)
    expect(result.warnings.some((warning) => warning.includes('不同的 SDK 目录'))).toBe(true)
  })

  it('SDK 完全找不到时报缺失，且不抛异常', async () => {
    const projectDir = createProject(workspace, 'project-d')

    const result = await collectEnvironment(projectDir)
    const sdkItem = result.items.find((item) => item.id === 'androidSdk')

    expect(result.success).toBe(true)
    expect(sdkItem?.state).toBe('error')
    expect(sdkItem?.detail).toContain('没找到')
  })

  it('项目缺 gradlew 时报缺失', async () => {
    const projectDir = createProject(workspace, 'project-e', { gradlew: false })
    vi.stubEnv('ANDROID_HOME', createFakeSdk(workspace, 'sdk-for-e'))

    const result = await collectEnvironment(projectDir)
    const gradlewItem = result.items.find((item) => item.id === 'gradlew')

    expect(gradlewItem?.state).toBe('error')
    expect(gradlewItem?.detail).toContain('gradlew')
  })

  it('JAVA_HOME 指向不存在的目录时报缺失', async () => {
    const projectDir = createProject(workspace, 'project-f')
    vi.stubEnv('JAVA_HOME', join(workspace, 'not-exist-jdk'))

    const result = await collectEnvironment(projectDir)
    const javaItem = result.items.find((item) => item.id === 'java')

    expect(javaItem?.state).toBe('error')
    expect(javaItem?.value).toBe(join(workspace, 'not-exist-jdk'))
  })

  it('不给项目目录时三项都能给出结果而不是崩溃', async () => {
    const result = await collectEnvironment()
    expect(result.items.map((item) => item.id).sort()).toEqual(['androidSdk', 'gradlew', 'java'])
    expect(result.projectPath).toBeNull()
  })
})
