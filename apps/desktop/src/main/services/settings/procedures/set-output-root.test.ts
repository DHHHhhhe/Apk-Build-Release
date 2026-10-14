import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 这三处是外层依赖：日志（要 Electron）、设置存储、读回设置。
// 这一组用例关心的是「往上找 Git 根 + 拒绝」这段真实逻辑，所以只把它们替掉。
const store = { outputRoot: '' }

vi.mock('../../logger', () => ({
  logger: { scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}))

vi.mock('../../build/lib/settings', () => ({
  setOutputRoot: (path: string) => {
    store.outputRoot = path
  }
}))

vi.mock('./get', () => ({
  readSettings: () => ({ success: true, settings: { outputRoot: store.outputRoot } })
}))

const { updateOutputRoot } = await import('./set-output-root')

let root = ''
/** 造一个「仓库」：只放一个 `.git` 目录就够，判断依据就是这个 */
let repo = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'abr-output-root-'))
  repo = join(root, 'repo')
  mkdirSync(join(repo, '.git'), { recursive: true })
  store.outputRoot = ''
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('updateOutputRoot', () => {
  it('仓库里的目录：拒绝，且不落盘', () => {
    const result = updateOutputRoot({ path: join(repo, 'out', 'apk') })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Git 仓库')
    expect(store.outputRoot).toBe('')
  })

  it('仓库根自己：同样拒绝', () => {
    expect(updateOutputRoot({ path: repo }).success).toBe(false)
  })

  it('仓库外：放行，并存成绝对路径', () => {
    const outside = join(root, 'apk-out')
    const result = updateOutputRoot({ path: outside })

    expect(result.success).toBe(true)
    expect(store.outputRoot).toBe(outside)
  })

  it('目录还不存在也能判断（从最近的存在的祖先往上找）', () => {
    expect(updateOutputRoot({ path: join(repo, 'a', 'b', 'c') }).success).toBe(false)
  })

  it('相对路径先绝对化再判断 —— 测试进程的工作目录就在本仓库里，所以照样被拒', () => {
    const result = updateOutputRoot({ path: 'apk-out' })

    expect(result.success).toBe(false)
    expect(store.outputRoot).toBe('')
  })

  it('给的是个文件：拒绝（原有行为不能丢）', () => {
    const file = join(root, 'a.txt')
    writeFileSync(file, 'x')

    const result = updateOutputRoot({ path: file })

    expect(result.success).toBe(false)
    expect(result.error).toContain('不是文件')
  })

  it('空路径：走原有校验拒绝', () => {
    expect(updateOutputRoot({ path: '  ' }).success).toBe(false)
  })
})
