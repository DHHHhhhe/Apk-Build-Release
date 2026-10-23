import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SECTION_TAGS } from './changelog-tags'
import { parseChangelog } from './changelog'

/**
 * 这几个用例守的是「分类漏标」这一类回归：
 * 0.8.0 之前 SECTION_STYLE 里没有「变更」，于是它和「说明」都落到中性标签上，
 * 同一版里的几类改动看起来是同一类。漏掉的分类现在会直接让测试挂掉。
 */
const markdown = readFileSync(new URL('../../../../../../CHANGELOG.md', import.meta.url), 'utf8')
const titlesInChangelog = Array.from(
  new Set(parseChangelog(markdown).flatMap((release) => release.sections.map((s) => s.title)))
).filter((title) => title.length > 0)

describe('SECTION_TAGS', () => {
  it('CHANGELOG 里出现的每个分类都得在表里（否则会退化成中性标签）', () => {
    const missing = titlesInChangelog.filter((title) => SECTION_TAGS[title] === undefined)
    expect(missing).toEqual([])
  })

  it('只使用语义色，不引装饰色', () => {
    const allowed = ['default', 'success', 'warning', 'destructive', 'info', 'muted']
    for (const [title, tag] of Object.entries(SECTION_TAGS)) {
      expect(allowed, `分类「${title}」用了未知变体 ${tag.variant}`).toContain(tag.variant)
    }
  })

  it('变更 与 说明 不能是同一档样式（0.8.0 那个 bug）', () => {
    expect(SECTION_TAGS.变更?.variant).not.toBe(SECTION_TAGS.说明?.variant)
    expect(SECTION_TAGS.变更?.Icon).not.toBe(SECTION_TAGS.说明?.Icon)
  })

  it('每种分类都有图标：颜色相近时靠图标区分', () => {
    for (const [title, tag] of Object.entries(SECTION_TAGS)) {
      expect(tag.Icon, `分类「${title}」缺图标`).toBeTruthy()
    }
  })
})
