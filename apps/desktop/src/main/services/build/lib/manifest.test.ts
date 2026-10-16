import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../logger', () => ({
  logger: { scope: () => ({ info: vi.fn(), warn: vi.fn() }) }
}))

import { MANIFEST_FILE_NAME, readManifest, recordArtifact } from './manifest'

describe('归档 manifest', () => {
  let folder = ''

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'abr-manifest-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  it('记下某个变体最新的产物', () => {
    recordArtifact(folder, {
      variant: 'freeRelease',
      apkName: 'app-free-release.apk',
      apkPath: join(folder, 'app-free-release.apk'),
      signed: true,
      copiedAt: 1000
    })

    const manifest = readManifest(folder)
    expect(manifest?.artifacts).toHaveLength(1)
    expect(manifest?.artifacts[0]?.variant).toBe('freeRelease')
    expect(manifest?.artifacts[0]?.signed).toBe(true)
  })

  it('同一个变体再出一次时替换成新的，而不是越堆越多', () => {
    recordArtifact(folder, {
      variant: 'freeRelease',
      apkName: 'app-free-release.apk',
      apkPath: join(folder, 'app-free-release.apk'),
      signed: true,
      copiedAt: 1000
    })
    recordArtifact(folder, {
      variant: 'freeRelease',
      apkName: 'app-free-release-2.apk',
      apkPath: join(folder, 'app-free-release-2.apk'),
      signed: true,
      copiedAt: 2000
    })

    const manifest = readManifest(folder)
    expect(manifest?.artifacts).toHaveLength(1)
    expect(manifest?.artifacts[0]?.apkName).toBe('app-free-release-2.apk')
  })

  it('不同变体各留一条', () => {
    recordArtifact(folder, {
      variant: 'freeRelease',
      apkName: 'a.apk',
      apkPath: join(folder, 'a.apk'),
      signed: null,
      copiedAt: 1
    })
    recordArtifact(folder, {
      variant: 'paidRelease',
      apkName: 'b.apk',
      apkPath: join(folder, 'b.apk'),
      signed: false,
      copiedAt: 2
    })

    expect(readManifest(folder)?.artifacts.map((item) => item.variant).sort()).toEqual([
      'freeRelease',
      'paidRelease'
    ])
  })

  it('文件损坏时当作没有，不让读 manifest 这件事影响出包', () => {
    writeFileSync(join(folder, MANIFEST_FILE_NAME), '这不是 json', 'utf8')
    expect(readManifest(folder)).toBeNull()
  })

  it('目录不存在时不抛异常', () => {
    expect(readManifest(join(folder, 'nope'))).toBeNull()
  })

  it('写出来的是可读的 JSON（人工也能看）', () => {
    recordArtifact(folder, {
      variant: 'freeRelease',
      apkName: 'a.apk',
      apkPath: join(folder, 'a.apk'),
      signed: true,
      copiedAt: 5
    })
    const raw = readFileSync(join(folder, MANIFEST_FILE_NAME), 'utf8')
    expect(raw).toContain('\n')
    expect(JSON.parse(raw).artifacts[0].apkName).toBe('a.apk')
  })
})
