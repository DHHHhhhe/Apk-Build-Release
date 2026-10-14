import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVersionsDesc, describeSigner, findApksigner, verifyApkSignature } from './signing'

let workspace: string

function writeFile(relativePath: string, content: string): string {
  const fullPath = join(workspace, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
  return fullPath
}

/** 造一个假的 apksigner.bat：输出指定内容并以指定退出码结束 */
function fakeApksigner(version: string, output: string, exitCode: number): void {
  writeFile(
    `sdk/build-tools/${version}/apksigner.bat`,
    `@echo off\r\necho ${output}\r\nexit /b ${exitCode}\r\n`
  )
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-signing-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('compareVersionsDesc', () => {
  it('按数字段比较，9.0.0 排在 34.0.0 后面', () => {
    const sorted = ['9.0.0', '34.0.0', '33.0.2', '34.1.0'].sort(compareVersionsDesc)
    expect(sorted).toEqual(['34.1.0', '34.0.0', '33.0.2', '9.0.0'])
  })

  it('带后缀的版本按前面的数字段比较', () => {
    const sorted = ['36.0.0-rc1', '35.0.0'].sort(compareVersionsDesc)
    expect(sorted[0]).toBe('36.0.0-rc1')
  })
})

describe('describeSigner', () => {
  it('认得旧版标签 Signer #1 certificate DN', () => {
    expect(describeSigner('Signer #1 certificate DN: CN=Android Debug, O=Android')).toBe(
      '已签名：CN=Android Debug, O=Android'
    )
  })

  it('认得 37.0.0 的标签 V2 Signer: certificate DN', () => {
    expect(describeSigner('V2 Signer: certificate DN: CN=Demo Signer, O=Demo')).toBe(
      '已签名：CN=Demo Signer, O=Demo'
    )
  })

  it('认不出来时只说已签名', () => {
    expect(describeSigner('verified')).toBe('已签名')
  })
})

describe('findApksigner', () => {
  it('取 build-tools 里版本最高的那个', () => {
    fakeApksigner('33.0.2', 'ok', 0)
    fakeApksigner('34.0.0', 'ok', 0)
    fakeApksigner('9.0.0', 'ok', 0)

    const found = findApksigner(join(workspace, 'sdk'))
    expect(found).toContain(join('34.0.0', 'apksigner.bat'))
  })

  it('没有 build-tools 时返回 null', () => {
    expect(findApksigner(join(workspace, 'sdk'))).toBeNull()
  })

  it('build-tools 存在但没有 apksigner 时返回 null', () => {
    mkdirSync(join(workspace, 'sdk/build-tools/34.0.0'), { recursive: true })
    expect(findApksigner(join(workspace, 'sdk'))).toBeNull()
  })
})

describe('verifyApkSignature', () => {
  const isWindows = process.platform === 'win32'

  it.skipIf(!isWindows)('退出码 0 时判定已签名并读出证书 DN', async () => {
    fakeApksigner('34.0.0', 'Signer #1 certificate DN: CN=Test, O=Demo', 0)
    const apkPath = writeFile('out/app-release.apk', 'fake-apk')

    const check = await verifyApkSignature({ apkPath, sdkDir: join(workspace, 'sdk') })
    expect(check.signed).toBe(true)
    expect(check.detail).toContain('CN=Test')
  })

  it.skipIf(!isWindows)('输出 DOES NOT VERIFY 时判定未签名', async () => {
    fakeApksigner('34.0.0', 'DOES NOT VERIFY', 1)
    const apkPath = writeFile('out/app-release-unsigned.apk', 'fake-apk')

    const check = await verifyApkSignature({ apkPath, sdkDir: join(workspace, 'sdk') })
    expect(check.signed).toBe(false)
    expect(check.detail).toContain('不能直接安装')
  })

  it('没有 SDK 时返回未验证而不是判失败', async () => {
    const apkPath = writeFile('out/app-release.apk', 'fake-apk')
    const check = await verifyApkSignature({ apkPath, sdkDir: null })
    expect(check.signed).toBeNull()
    expect(check.detail).toContain('未验证')
  })

  it('SDK 里没有 apksigner 时同样返回未验证', async () => {
    mkdirSync(join(workspace, 'sdk/build-tools/34.0.0'), { recursive: true })
    const apkPath = writeFile('out/app-release.apk', 'fake-apk')
    const check = await verifyApkSignature({ apkPath, sdkDir: join(workspace, 'sdk') })
    expect(check.signed).toBeNull()
  })
})
