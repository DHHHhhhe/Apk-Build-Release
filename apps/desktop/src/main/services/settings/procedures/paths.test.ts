import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const openPathMock = vi.fn<(path: string) => Promise<string>>(async () => '')

vi.mock('electron', () => ({
  shell: { openPath: (path: string) => openPathMock(path) }
}))
vi.mock('../../logger', () => ({
  logger: { scope: () => ({ info: vi.fn(), warn: vi.fn() }) }
}))
vi.mock('./get', () => ({ getLogDir: () => '' }))

import { openPath } from './paths'

describe('openPath', () => {
  let workspace = ''

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'abr-open-path-'))
    openPathMock.mockClear()
    openPathMock.mockResolvedValue('')
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('已存在的文件：不碰目录，直接交给系统打开 —— 这条以前是静默失败', async () => {
    const file = join(workspace, 'run.log')
    writeFileSync(file, '构建日志')

    const result = await openPath({ path: file })

    expect(result.success).toBe(true)
    expect(openPathMock).toHaveBeenCalledWith(file)
    // 还是文件：没有被 mkdirSync 抛出的 EEXIST 打断
    expect(statSync(file).isFile()).toBe(true)
  })

  it('不存在的路径：先建目录再打开（输出目录 / 日志目录第一次打开就是这种）', async () => {
    const dir = join(workspace, 'not-yet')

    const result = await openPath({ path: dir })

    expect(result.success).toBe(true)
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
  })

  it('已存在的目录：直接打开', async () => {
    const dir = join(workspace, 'exists')
    mkdirSync(dir)

    const result = await openPath({ path: dir })

    expect(result.success).toBe(true)
    expect(openPathMock).toHaveBeenCalledWith(dir)
  })

  it('系统打不开时把原因带回去，而不是假装成功', async () => {
    const file = join(workspace, 'run.log')
    writeFileSync(file, 'x')
    openPathMock.mockResolvedValue('没有关联的应用')

    const result = await openPath({ path: file })

    expect(result.success).toBe(false)
    expect(result.error).toContain('没有关联的应用')
  })

  it('路径非法时直接拒绝，不去动文件系统', async () => {
    const result = await openPath({ path: '' })

    expect(result.success).toBe(false)
    expect(openPathMock).not.toHaveBeenCalled()
  })
})
