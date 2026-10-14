import { describe, expect, it } from 'vitest'
import { variantBadgeVisibility } from './variant-badges'

const buildType = (buildTypeName: string, flavor: string | null = null): { name: string; buildType: string; flavor: string | null } => ({
  name: `${flavor ?? ''}${buildTypeName}`,
  buildType: buildTypeName,
  flavor
})

describe('variantBadgeVisibility', () => {
  it('单一 flavor + 全是 release：两个标签都不显示（这就是界面上那些噪音）', () => {
    const variants = [buildType('release', 'demo_flavor'), buildType('release', 'demo_flavor')]
    expect(variantBadgeVisibility(variants)).toEqual({ flavor: false, buildType: false })
  })

  it('多 flavor：flavor 是区分行的唯一依据，必须显示', () => {
    const variants = [buildType('release', 'free'), buildType('release', 'paid')]
    expect(variantBadgeVisibility(variants)).toEqual({ flavor: true, buildType: false })
  })

  it('buildType 不统一时才显示 buildType', () => {
    const variants = [buildType('release', 'free'), buildType('debug', 'free')]
    expect(variantBadgeVisibility(variants)).toEqual({ flavor: false, buildType: true })
  })

  it('flavor 为 null 的变体不参与 flavor 判断，不能让一个 null 就把标签逼出来', () => {
    const variants = [buildType('release', 'free'), buildType('release', null)]
    expect(variantBadgeVisibility(variants).flavor).toBe(false)
  })

  it('空列表：什么都不显示，不抛异常', () => {
    expect(variantBadgeVisibility([])).toEqual({ flavor: false, buildType: false })
  })
})
