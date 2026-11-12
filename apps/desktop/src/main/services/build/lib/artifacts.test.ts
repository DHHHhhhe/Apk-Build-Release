import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyArtifactToOutput, findApkArtifacts, readOutputMetadata, resolveOutputFolderName } from './artifacts'

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

  it('别名优先：文件夹名由 resolveOutputFolderName 决定，文件真的落进别名目录', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'bytes')
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

    // 别名与项目名的解析在同一处（resolveOutputFolderName），这里把两段接起来验落盘
    const folder = resolveOutputFolderName({ alias: 'demo-alias', name: '模板工程' })
    const target = copyArtifactToOutput(artifact, outputRoot, folder)

    expect(folder).toBe('demo-alias')
    expect(target).toContain(join('demo-alias', 'app-release.apk'))
    expect(readFileSync(target, 'utf8')).toBe('bytes')
  })

  it('别名里塞「上一级」也跑不出输出目录', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'bytes')
    const outputRoot = join(workspace, 'out')
    const folder = resolveOutputFolderName({ alias: '../../evil', name: '模板工程' })
    const target = copyArtifactToOutput(
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
      folder
    )

    // 关键：复制结果必须仍在统一输出目录之内（别名是用户随手填的）
    const rel = relative(outputRoot, target)
    expect(rel.startsWith('..')).toBe(false)
    expect(target.startsWith(outputRoot)).toBe(true)
  })

  it('开启覆盖后同名产物被替换，只剩一份', () => {
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

    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'old')
    const first = copyArtifactToOutput(artifact, outputRoot, 'demo app', { overwrite: true })
    expect(readFileSync(first, 'utf8')).toBe('old')

    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'new')
    const second = copyArtifactToOutput(artifact, outputRoot, 'demo app', { overwrite: true })

    expect(second).toBe(first)
    expect(readFileSync(second, 'utf8')).toBe('new')
    // 覆盖模式下不该再堆出带时间戳的副本
    expect(readdirSync(join(outputRoot, 'demo app'))).toEqual(['app-release.apk'])
  })

  it('默认不覆盖：不传 overwrite 时仍然加时间戳后缀', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'bytes')
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

    copyArtifactToOutput(artifact, outputRoot, 'demo app')
    copyArtifactToOutput(artifact, outputRoot, 'demo app')

    expect(readdirSync(join(outputRoot, 'demo app')).length).toBe(2)
  })

  it('覆盖时源文件读不到，旧包保持原样且不留临时文件', () => {
    const outputRoot = join(workspace, 'out')
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'old')
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

    const target = copyArtifactToOutput(artifact, outputRoot, 'demo app', { overwrite: true })
    expect(readFileSync(target, 'utf8')).toBe('old')

    // 源文件消失（模拟复制中途拿不到源），覆盖不能把已经落在输出目录的完整旧包弄坏
    rmSync(artifact.apkPath, { force: true })
    expect(() => copyArtifactToOutput(artifact, outputRoot, 'demo app', { overwrite: true })).toThrow()

    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(readdirSync(join(outputRoot, 'demo app'))).toEqual(['app-release.apk'])
  })

  it('输出目录就是项目的产物目录时不复制，避免把源文件清空', () => {
    writeFile('app/build/outputs/apk/free/release/app-release.apk', 'bytes')
    const apkPath = join(workspace, 'app/build/outputs/apk/free/release/app-release.apk')
    const artifact = {
      apkPath,
      apkName: 'app-release.apk',
      applicationId: null,
      variantName: null,
      versionCode: null,
      versionName: null,
      signed: null,
      matchedBy: 'filename' as const
    }

    // 目标目录与源目录重合（projectName 取 'release'，outputRoot 指到它上面两级）
    const target = copyArtifactToOutput(artifact, join(workspace, 'app/build/outputs/apk/free'), 'release', {
      overwrite: true
    })

    expect(target).toBe(apkPath)
    expect(readFileSync(apkPath, 'utf8')).toBe('bytes')
  })
})
