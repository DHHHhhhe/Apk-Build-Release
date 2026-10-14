import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyArtifactToOutput, findApkArtifacts, readOutputMetadata } from './artifacts'

let workspace: string

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(workspace, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
}

function metadata(applicationId: string, variantName: string, outputFile: string, versionName = '1.5.0', versionCode = 150): string {
  return JSON.stringify(
    {
      version: 3,
      artifactType: { type: 'APK', kind: 'Directory' },
      applicationId,
      variantName,
      elements: [
        { type: 'SINGLE', filters: [], attributes: [], versionCode, versionName, outputFile }
      ],
      elementType: 'File'
    },
    null,
    2
  )
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-artifacts-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('readOutputMetadata', () => {
  it('读出 applicationId / variantName / elements 字段', () => {
    const file = join(workspace, 'output-metadata.json')
    writeFileSync(file, metadata('com.demo.sample', 'demo_flavorDebug', 'app-debug.apk'), 'utf8')

    const parsed = readOutputMetadata(file)
    expect(parsed?.applicationId).toBe('com.demo.sample')
    expect(parsed?.variantName).toBe('demo_flavorDebug')
    expect(parsed?.elements[0]?.versionName).toBe('1.5.0')
    expect(parsed?.elements[0]?.outputFile).toBe('app-debug.apk')
  })

  it('坏 JSON 不抛异常', () => {
    const file = join(workspace, 'broken.json')
    writeFileSync(file, '{ not json', 'utf8')
    expect(readOutputMetadata(file)).toBeNull()
  })
})

describe('findApkArtifacts', () => {
  it('按 output-metadata.json 定位变体产物，并排除 androidTest', () => {
    writeFile(
      'app/build/outputs/apk/demo_flavor/debug/output-metadata.json',
      metadata('com.demo.sample', 'demo_flavorDebug', '示例_V1.0.0_debug包.apk')
    )
    writeFile('app/build/outputs/apk/demo_flavor/debug/示例_V1.0.0_debug包.apk', 'apk-bytes')
    writeFile(
      'app/build/outputs/apk/androidTest/demo_flavor/debug/output-metadata.json',
      metadata('com.demo.sample', 'demo_flavorDebug', 'app-debug-androidTest.apk')
    )
    writeFile('app/build/outputs/apk/androidTest/demo_flavor/debug/app-debug-androidTest.apk', 'test-apk')

    const artifacts = findApkArtifacts({
      projectPath: workspace,
      moduleDirs: ['app'],
      expectedVariant: 'demo_flavorDebug'
    })

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.apkName).toBe('示例_V1.0.0_debug包.apk')
    expect(artifacts[0]?.applicationId).toBe('com.demo.sample')
    expect(artifacts[0]?.matchedBy).toBe('metadata')
    expect(artifacts[0]?.signed).toBeNull()
  })

  it('变体名大小写不敏感，且不匹配的变体不会返回', () => {
    writeFile(
      'app/build/outputs/apk/free/release/output-metadata.json',
      metadata('com.demo', 'freeRelease', 'app-release.apk')
    )
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'apk')

    const matched = findApkArtifacts({
      projectPath: workspace,
      moduleDirs: ['app'],
      expectedVariant: 'freerelease'
    })
    expect(matched).toHaveLength(1)

    const unmatched = findApkArtifacts({
      projectPath: workspace,
      moduleDirs: ['app'],
      expectedVariant: 'freeDebug'
    })
    expect(unmatched).toHaveLength(0)
  })

  it('没有 metadata 时按文件名退化匹配', () => {
    writeFile('app/build/outputs/apk/legacy/demo_flavorDebug/app-demo_flavorDebug.apk', 'apk')

    const artifacts = findApkArtifacts({
      projectPath: workspace,
      moduleDirs: ['app'],
      expectedVariant: 'demo_flavorDebug'
    })

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.matchedBy).toBe('filename')
  })

  it('文件名带 unsigned 时能判定未签名', () => {
    writeFile(
      'app/build/outputs/apk/free/release/output-metadata.json',
      metadata('com.demo', 'freeRelease', 'app-release-unsigned.apk')
    )
    writeFile('app/build/outputs/apk/free/release/app-release-unsigned.apk', 'apk')

    const artifacts = findApkArtifacts({
      projectPath: workspace,
      moduleDirs: ['app'],
      expectedVariant: 'freeRelease'
    })
    expect(artifacts[0]?.signed).toBe(false)
  })
})

describe('copyArtifactToOutput', () => {
  it('按项目分子目录复制并保留原名', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'first')
    const outputRoot = join(workspace, 'out')

    const first = copyArtifactToOutput(
      {
        apkPath: join(workspace, 'app/build/outputs/apk/free/release/app-release.apk'),
        apkName: 'app-release.apk',
        applicationId: null,
        variantName: null,
        versionCode: null,
        versionName: null,
        signed: null,
        matchedBy: 'filename'
      },
      outputRoot,
      'demo app'
    )

    expect(first).toContain(join('demo app', 'app-release.apk'))
    expect(readFileSync(first, 'utf8')).toBe('first')
  })

  it('重名时加时间戳后缀，不覆盖旧产物', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'first')
    const outputRoot = join(workspace, 'out')
    const artifact = {
      apkPath: join(workspace, 'app/build/outputs/apk/free/release/app-release.apk'),
      apkName: 'app-release.apk',
      applicationId: null,
      variantName: null,
      versionCode: null,
      versionName: null,
      signed: null,
      matchedBy: 'filename' as const
    }

    const first = copyArtifactToOutput(artifact, outputRoot, 'demo app')
    const second = copyArtifactToOutput(artifact, outputRoot, 'demo app')

    expect(second).not.toBe(first)
    // 形如 app-release_20261014-003012.apk，能看出哪个是新的
    expect(/app-release_\d{8}-\d{6}\.apk$/.test(second)).toBe(true)
    expect(readFileSync(first, 'utf8')).toBe('first')
    expect(readFileSync(second, 'utf8')).toBe('first')
  })
})
