import { describe, expect, it } from 'vitest'
import { filterVariantsForPackaging, isReleaseBuildType } from './variants'

describe('isReleaseBuildType', () => {
  it('大小写与空格都不影响判断', () => {
    expect(isReleaseBuildType('release')).toBe(true)
    expect(isReleaseBuildType('Release')).toBe(true)
    expect(isReleaseBuildType(' RELEASE ')).toBe(true)
    expect(isReleaseBuildType('debug')).toBe(false)
  })
})

describe('filterVariantsForPackaging', () => {
  it('只保留发布变体，debug 不再出现在出包列表里', () => {
    const variants = [
      { name: 'demo_flavorRelease', buildType: 'release' },
      { name: 'demo_flavorDebug', buildType: 'debug' },
      { name: 'freeRelease', buildType: 'release' },
      { name: 'freeDebug', buildType: 'debug' }
    ]
    expect(filterVariantsForPackaging(variants).map((variant) => variant.name)).toEqual([
      'demo_flavorRelease',
      'freeRelease'
    ])
  })

  it('项目连一个 release 变体都没有时退回全部，不能把列表清空', () => {
    const variants = [{ name: 'freeDebug', buildType: 'debug' }]
    expect(filterVariantsForPackaging(variants)).toEqual(variants)
  })

  it('自定义 buildType（如 staging）不当作发布变体', () => {
    const variants = [
      { name: 'freeStaging', buildType: 'staging' },
      { name: 'freeRelease', buildType: 'release' }
    ]
    expect(filterVariantsForPackaging(variants).map((variant) => variant.name)).toEqual(['freeRelease'])
  })
})
