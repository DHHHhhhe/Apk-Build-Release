import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { copyArtifactToOutput, resolveOutputFolderName, type ApkArtifact } from './artifacts'

/**
 * 别名 → 输出目录名 → 真正落盘。
 *
 * 「名字怎么算」已有测试（output-folder.test.ts），这里补后半段：
 * 文件确实被复制进「别名文件夹」，而不是项目名文件夹，也不会跑出输出目录。
 * 用临时目录做真实文件复制 —— 这一段的价值就在真实 IO 上，用假文件系统测等于没测。
 */
let workspace: string
let outputRoot: string
let apkPath: string

function artifact(name = 'app-debug.apk'): ApkArtifact {
  return {
    apkPath,
    apkName: name,
    applicationId: 'com.demo.sample',
    variantName: 'demoDebug',
    versionCode: 1,
    versionName: '1.0.0',
    signed: true,
    matchedBy: 'metadata'
  }
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-artifacts-'))
  outputRoot = join(workspace, 'out')
  mkdirSync(outputRoot, { recursive: true })
  apkPath = join(workspace, 'app-debug.apk')
  writeFileSync(apkPath, 'fake apk bytes', 'utf8')
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
})

describe('产物复制到输出目录', () => {
  it('有别名时落进别名文件夹', () => {
    const folder = resolveOutputFolderName({ alias: 'demo-alias', name: '模板工程' })
    const target = copyArtifactToOutput(artifact(), outputRoot, folder)

    expect(folder).toBe('demo-alias')
    expect(existsSync(target)).toBe(true)
    expect(target.startsWith(join(outputRoot, 'demo-alias') + sep)).toBe(true)
    expect(target.endsWith('app-debug.apk')).toBe(true)
  })

  it('没别名时落进项目名文件夹', () => {
    const folder = resolveOutputFolderName({ alias: null, name: '示例应用' })
    const target = copyArtifactToOutput(artifact(), outputRoot, folder)

    expect(target.startsWith(join(outputRoot, '示例应用') + sep)).toBe(true)
  })

  it('重名不覆盖：第二次复制会换一个文件名', () => {
    const folder = 'demo-alias'
    const first = copyArtifactToOutput(artifact(), outputRoot, folder)
    const second = copyArtifactToOutput(artifact(), outputRoot, folder)

    expect(second).not.toBe(first)
    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(true)
  })

  it('别名里塞「上一级」也跑不出输出目录', () => {
    const folder = resolveOutputFolderName({ alias: '../../evil', name: '示例应用' })
    const target = copyArtifactToOutput(artifact(), outputRoot, folder)

    // 关键：复制结果必须仍在统一输出目录之内
    const rel = relative(outputRoot, target)
    expect(rel.startsWith('..')).toBe(false)
    expect(target.startsWith(outputRoot + sep)).toBe(true)
  })
})