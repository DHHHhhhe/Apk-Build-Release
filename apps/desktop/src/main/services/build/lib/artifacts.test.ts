import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  artifactFamilyKey,
  copyArtifactToOutput,
  findApkArtifacts,
  pruneVariantDir,
  pruneVariantHistory,
  readOutputMetadata,
  resolveOutputFolderName
} from './artifacts'

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

describe('artifactFamilyKey（同一变体的产物族）', () => {
  it('剥掉 Gradle 拼进文件名的构建时间戳', () => {
    // 真实工程里 outputFileName 是 appName + _V版本 + buildType + _yyyyMMdd_HHmm.apk
    expect(artifactFamilyKey('示例_V1.5.0_20261022_1024.apk')).toBe('示例_V1.5.0')
    expect(artifactFamilyKey('示例_V1.5.0_20261112_1746.apk')).toBe('示例_V1.5.0')
  })

  it('同一次构建的不同时间戳属于同一个族，debug 与 release 不属于', () => {
    expect(artifactFamilyKey('示例_V1.5.0_20261022_1024.apk')).toBe(
      artifactFamilyKey('示例_V1.5.0_20261023_1044.apk')
    )
    expect(artifactFamilyKey('示例_V1.5.0_debug包_20261022_1024.apk')).not.toBe(
      artifactFamilyKey('示例_V1.5.0_20261022_1024.apk')
    )
  })

  it('带秒与带短横线的时间戳也能剥掉', () => {
    expect(artifactFamilyKey('app_20261022_103600.apk')).toBe('app')
    expect(artifactFamilyKey('app_20261022-103600.apk')).toBe('app')
  })

  it('不像日期时间的数字不当成时间戳，避免误归族', () => {
    // 13 月不合法：整段保留，不会被当成时间戳剥掉
    expect(artifactFamilyKey('报告_20261399_0000.apk')).toBe('报告_20261399_0000')
    expect(artifactFamilyKey('app-release.apk')).toBe('app-release')
  })
})

describe('pruneVariantDir（清空目录，只留保留清单）', () => {
  it('只留本次产物，清掉所有历史包', () => {
    const dir = join(workspace, 'out', '示例')
    mkdirSync(dir, { recursive: true })
    for (const name of [
      '示例_V1.5.0_20261022_1024.apk',
      '示例_V1.5.0_20261022_1036.apk',
      '示例_V1.5.0_20261023_1044.apk',
      '示例_V1.5.0_20261112_1746.apk'
    ]) {
      writeFileSync(join(dir, name), 'apk', 'utf8')
    }

    const removed = pruneVariantDir(dir, new Set(['示例_V1.5.0_20261112_1746.apk']))

    expect(readdirSync(dir)).toEqual(['示例_V1.5.0_20261112_1746.apk'])
    expect(removed.sort()).toEqual([
      '示例_V1.5.0_20261022_1024.apk',
      '示例_V1.5.0_20261022_1036.apk',
      '示例_V1.5.0_20261023_1044.apk'
    ])
  })

  it('非 APK 普通文件也一起清掉', () => {
    const dir = join(workspace, 'out', '示例')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '示例_V1.5.0_20261112_1746.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '说明.txt'), 'text', 'utf8')
    writeFileSync(join(dir, 'build.log'), 'log', 'utf8')
    writeFileSync(join(dir, '旧包.apk'), 'apk', 'utf8')

    const removed = pruneVariantDir(dir, new Set(['示例_V1.5.0_20261112_1746.apk']))

    expect(readdirSync(dir)).toEqual(['示例_V1.5.0_20261112_1746.apk'])
    expect(removed.sort()).toEqual(['build.log', '旧包.apk', '说明.txt'].sort())
  })

  it('保留清单里的东西一个都不动（同一批 debug 与 release 共存）', () => {
    const dir = join(workspace, 'out', '示例')
    mkdirSync(dir, { recursive: true })
    const keep = ['示例_V1.5.0_debug包_20261113_1020.apk', '示例_V1.5.0_20261113_1030.apk']
    for (const name of [...keep, '示例_V1.5.0_20261022_1024.apk']) {
      writeFileSync(join(dir, name), 'apk', 'utf8')
    }

    pruneVariantDir(dir, new Set(keep))

    expect(readdirSync(dir).sort()).toEqual([...keep].sort())
  })

  it('目录不存在时返回空，不抛错', () => {
    expect(pruneVariantDir(join(workspace, 'nope'), new Set())).toEqual([])
  })

  it('子文件夹整体清除（多渠道打包输出），本次产物保留', () => {
    const dir = join(workspace, 'out', '示例')
    const channels = join(dir, '渠道包')
    mkdirSync(channels, { recursive: true })
    writeFileSync(join(dir, '示例_V1.5.0_20261113_1028.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '示例_V1.5.0_20261113_1032.apk'), 'apk', 'utf8')
    // 上一次构建留下的渠道包：里面是两个渠道的包
    writeFileSync(join(channels, '示例_V1.5.0_20261113_1028_官方.apk'), 'apk', 'utf8')
    writeFileSync(join(channels, '示例_V1.5.0_20261113_1028_快手.apk'), 'apk', 'utf8')

    const removed = pruneVariantDir(dir, new Set(['示例_V1.5.0_20261113_1032.apk']))

    // 渠道包整个目录都没了，只留本次的 apk
    expect(existsSync(channels)).toBe(false)
    expect(readdirSync(dir)).toEqual(['示例_V1.5.0_20261113_1032.apk'])
    expect(removed.sort()).toEqual(['示例_V1.5.0_20261113_1028.apk', '渠道包/'].sort())
  })

  it('子文件夹里的东西再多也一起清掉，不只清一层', () => {
    const dir = join(workspace, 'out', '示例')
    const nested = join(dir, '渠道包', 'inner', 'deeper')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(dir, '示例_V1.5.0_20261113_1032.apk'), 'apk', 'utf8')
    writeFileSync(join(nested, 'x.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '渠道包', 'inner', 'y.apk'), 'apk', 'utf8')

    pruneVariantHistory(dir, '示例_V1.5.0_20261113_1032.apk')

    expect(existsSync(join(dir, '渠道包'))).toBe(false)
    expect(readdirSync(dir)).toEqual(['示例_V1.5.0_20261113_1032.apk'])
  })

  it('子文件夹与另一个变体的包同时存在时，只清子文件夹与同族旧包', () => {
    const dir = join(workspace, 'out', '示例')
    const channels = join(dir, '渠道包')
    mkdirSync(channels, { recursive: true })
    writeFileSync(join(dir, '示例_V1.5.0_20261113_1032.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '示例_V1.5.0_20261113_1028.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '示例_V1.5.0_debug包_20261113_1028.apk'), 'apk', 'utf8')
    writeFileSync(join(dir, '说明.txt'), 'text', 'utf8')
    writeFileSync(join(channels, '官方.apk'), 'apk', 'utf8')

    pruneVariantDir(dir, new Set(['示例_V1.5.0_20261113_1032.apk']))

    // 清空语义：除了保留清单里的，debug 包与说明文件也一起没了
    expect(existsSync(channels)).toBe(false)
    expect(readdirSync(dir)).toEqual(['示例_V1.5.0_20261113_1032.apk'])
  })
})

describe('copyArtifactToOutput + 覆盖（端到端串起来）', () => {
  it('构建时间戳每次不同，开启覆盖后目录里只剩本次的包', () => {
    const outputRoot = join(workspace, 'out')

    const build = (name: string, bytes: string): string => {
      const relativePath = `app/build/outputs/apk/free/release/${name}`
      writeFile(relativePath, bytes)
      return copyArtifactToOutput(
        {
          apkPath: join(workspace, relativePath),
          apkName: name,
          applicationId: null,
          variantName: null,
          versionCode: null,
          versionName: null,
          signed: null,
          matchedBy: 'filename'
        },
        outputRoot,
        '示例',
        { overwrite: true }
      )
    }

    build('示例_V1.5.0_20261022_1024.apk', 'first')
    build('示例_V1.5.0_20261022_1036.apk', 'second')
    build('示例_V1.5.0_20261023_1044.apk', 'third')
    const last = build('示例_V1.5.0_20261112_1746.apk', 'latest')

    expect(readdirSync(join(outputRoot, '示例'))).toEqual(['示例_V1.5.0_20261112_1746.apk'])
    expect(readFileSync(last, 'utf8')).toBe('latest')
  })

  it('不开覆盖时历史包照旧都留着', () => {
    const outputRoot = join(workspace, 'out')

    const build = (name: string): void => {
      const relativePath = `app/build/outputs/apk/free/release/${name}`
      writeFile(relativePath, 'apk')
      copyArtifactToOutput(
        {
          apkPath: join(workspace, relativePath),
          apkName: name,
          applicationId: null,
          variantName: null,
          versionCode: null,
          versionName: null,
          signed: null,
          matchedBy: 'filename'
        },
        outputRoot,
        '示例'
      )
    }

    build('示例_V1.5.0_20261022_1024.apk')
    build('示例_V1.5.0_20261112_1746.apk')

    expect(readdirSync(join(outputRoot, '示例')).length).toBe(2)
  })

  it('同一批两个变体共用目录时，后构建的不会删掉先构建的', () => {
    const outputRoot = join(workspace, 'out')
    const produced = new Set<string>()

    // 同一条队列项：先 debug，再 release，keep 一直累积
    const build = (name: string, bytes: string): string => {
      const relativePath = `app/build/outputs/apk/free/${name}`
      writeFile(relativePath, bytes)
      const target = copyArtifactToOutput(
        {
          apkPath: join(workspace, relativePath),
          apkName: name,
          applicationId: null,
          variantName: null,
          versionCode: null,
          versionName: null,
          signed: null,
          matchedBy: 'filename'
        },
        outputRoot,
        '示例',
        { overwrite: true, keep: produced }
      )
      produced.add(name)
      return target
    }

    // 目录里先放一批历史垃圾：旧包、子文件夹、说明文件
    const dir = join(outputRoot, '示例')
    mkdirSync(join(dir, '渠道包'), { recursive: true })
    writeFileSync(join(dir, '历史包_20260101_0000.apk'), 'old', 'utf8')
    writeFileSync(join(dir, '说明.txt'), 'text', 'utf8')
    writeFileSync(join(dir, '渠道包', '官方.apk'), 'apk', 'utf8')

    build('示例_V1.5.0_debug包_20261113_1020.apk', 'debug')
    build('示例_V1.5.0_20261113_1021.apk', 'release')

    const after = readdirSync(dir).sort()
    console.log('AFTER=' + JSON.stringify(after))

    // 两个本次产物都在；历史垃圾与子文件夹都没了
    expect(after).toEqual([
      '示例_V1.5.0_20261113_1021.apk',
      '示例_V1.5.0_debug包_20261113_1020.apk'
    ].sort())
    expect(existsSync(join(dir, '渠道包'))).toBe(false)
  })
})
