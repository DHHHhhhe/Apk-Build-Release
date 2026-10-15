import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeSignature, isSignatureCurrent, STATIC_PARSE_VERSION } from './cache'

/**
 * 解析缓存签名。
 *
 * 守的是已经踩过一次的坑：改了静态解析的逻辑，但文件 mtime 没变，
 * 用户就一直拿着旧结果（第 5 轮：字符串里的 `//` 让 flavor 读不出来，
 * 修完之后老项目仍然只显示一个假定出来的 Release）。
 * 所以签名必须带上解析器版本 —— 版本一抬，旧缓存全部作废。
 */
let workspace: string

function file(name: string, content = 'android { }\n'): string {
  const full = join(workspace, name)
  writeFileSync(full, content, 'utf8')
  return full
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-cache-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('computeSignature', () => {
  it('同一批文件算两次结果一致', () => {
    const files = [file('a.gradle'), file('b.gradle')]
    expect(computeSignature(files)).toBe(computeSignature(files))
  })

  it('签名里带着解析器版本 —— 改了逻辑就必须抬版本，否则旧缓存不会失效', () => {
    const signature = computeSignature([file('a.gradle')])
    expect(signature.startsWith(`v${STATIC_PARSE_VERSION}|`)).toBe(true)
  })

  it('文件顺序不影响签名（内部会排序）', () => {
    const a = file('a.gradle')
    const b = file('b.gradle')
    expect(computeSignature([a, b])).toBe(computeSignature([b, a]))
  })

  it('文件内容改了、mtime 变了，签名跟着变', () => {
    const target = file('a.gradle', 'android { }\n')
    const before = computeSignature([target])

    // 直接改 mtime，避免依赖文件系统的时间精度
    const later = new Date(Date.now() + 5000)
    utimesSync(target, later, later)

    expect(computeSignature([target])).not.toBe(before)
  })

  it('文件不存在时标 missing，不抛异常', () => {
    const missing = join(workspace, 'nope.gradle')
    const signature = computeSignature([missing])

    expect(signature).toContain(':missing')
    expect(() => computeSignature([missing])).not.toThrow()
  })
})

describe('isSignatureCurrent', () => {
  it('没存过签名时算过期', () => {
    expect(isSignatureCurrent(null, [file('a.gradle')])).toBe(false)
  })

  it('文件列表为空时算过期（没东西可解析）', () => {
    expect(isSignatureCurrent('v1|whatever', [])).toBe(false)
  })

  it('文件没动时算命中', () => {
    const files = [file('a.gradle'), file('b.gradle')]
    expect(isSignatureCurrent(computeSignature(files), files)).toBe(true)
  })

  it('文件动过之后算过期', () => {
    const target = file('a.gradle')
    const previous = computeSignature([target])

    const later = new Date(Date.now() + 5000)
    utimesSync(target, later, later)

    expect(isSignatureCurrent(previous, [target])).toBe(false)
  })

  it('换了另一版解析器（签名前缀不同）算过期', () => {
    const files = [file('a.gradle')]
    const fromOlderParser = computeSignature(files).replace(/^v\d+\|/, 'v1|')
    expect(isSignatureCurrent(fromOlderParser, files)).toBe(false)
  })
})