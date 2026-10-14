import { describe, expect, it } from 'vitest'
import { canonicalize, checkOutputRoot, isInside } from './output-root-guard'

describe('canonicalize', () => {
  it('绝对化、去掉尾部斜杠、统一小写', () => {
    expect(canonicalize('C:\\Repo\\out\\')).toBe('c:\\repo\\out')
    expect(canonicalize('C:/Repo/out')).toBe('c:\\repo\\out')
  })

  it('盘根不会被削成空串', () => {
    expect(canonicalize('C:\\')).toBe('c:\\')
  })
})

describe('isInside', () => {
  it('下钻的子目录算在里面', () => {
    expect(isInside('C:\\Repo\\out\\apk', 'C:\\Repo')).toBe(true)
  })

  it('自身算在里面', () => {
    expect(isInside('C:\\Repo', 'c:\\repo')).toBe(true)
  })

  it('大小写不同也认得出是同一个地方（Windows 文件名不区分大小写）', () => {
    expect(isInside('c:\\REPO\\out', 'C:\\Repo')).toBe(true)
  })

  it('同名前缀但不同目录不算在里面（这是字符串前缀比较会错的例子）', () => {
    expect(isInside('C:\\Repo-backup\\out', 'C:\\Repo')).toBe(false)
    expect(isInside('C:\\Repository', 'C:\\Repo')).toBe(false)
  })

  it('上一级不算在里面', () => {
    expect(isInside('C:\\', 'C:\\Repo')).toBe(false)
  })

  it('跨盘不算在里面', () => {
    expect(isInside('D:\\out', 'C:\\Repo')).toBe(false)
  })
})

describe('checkOutputRoot', () => {
  it('不在任何仓库里：放行', () => {
    expect(checkOutputRoot({ path: 'D:\\APK输出', gitRoot: null })).toEqual({ ok: true })
  })

  it('在仓库外：放行', () => {
    expect(checkOutputRoot({ path: 'D:\\APK输出', gitRoot: 'C:\\Repo' })).toEqual({ ok: true })
  })

  it('在仓库里：拒绝，并且说清后果与怎么办', () => {
    const result = checkOutputRoot({ path: 'C:\\Repo\\apps\\desktop\\release\\apk', gitRoot: 'C:\\Repo' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('Git 仓库')
      expect(result.error).toContain('C:\\Repo')
      expect(result.error).toContain('仓库外')
    }
  })

  it('仓库根自己也不行（在根目录直接出包同样会污染仓库）', () => {
    expect(checkOutputRoot({ path: 'C:\\Repo', gitRoot: 'C:\\Repo' }).ok).toBe(false)
  })
})
