import { describe, expect, it } from 'vitest'
import { filterVariantsForPackaging, isReleaseBuildType, resolveBuildableVariants } from './variants'

const mixed = [
  { name: 'demo_flavorRelease', buildType: 'release' },
  { name: 'demo_flavorDebug', buildType: 'debug' },
  { name: 'freeRelease', buildType: 'release' },
  { name: 'freeDebug', buildType: 'debug' }
]

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

describe('resolveBuildableVariants', () => {
  it('不显示 debug 时，勾选里的 debug 进 hiddenSelected、不参与构建', () => {
    const result = resolveBuildableVariants({
      variants: mixed,
      selected: ['freeDebug', 'freeRelease', 'demo_flavorDebug'],
      includeDebug: false
    })
    expect(result.buildable).toEqual(['freeRelease'])
    expect(result.hiddenSelected).toEqual(['freeDebug', 'demo_flavorDebug'])
    expect(result.unknownSelected).toEqual([])
  })

  it('显示 debug 时全部勾选都参与构建', () => {
    const result = resolveBuildableVariants({
      variants: mixed,
      selected: ['freeDebug', 'freeRelease'],
      includeDebug: true
    })
    expect(result.buildable).toEqual(['freeDebug', 'freeRelease'])
    expect(result.hiddenSelected).toEqual([])
  })

  it('只勾 debug 时 buildable 为空 —— 主进程据此拒绝入队', () => {
    const result = resolveBuildableVariants({
      variants: mixed,
      selected: ['freeDebug', 'demo_flavorDebug'],
      includeDebug: false
    })
    expect(result.buildable).toEqual([])
    expect(result.hiddenSelected).toHaveLength(2)
  })

  it('项目连 release 变体都没有时，debug 也是可构建的（与出包过滤的兜底一致）', () => {
    const result = resolveBuildableVariants({
      variants: [{ name: 'onlyDebug', buildType: 'debug' }],
      selected: ['onlyDebug'],
      includeDebug: false
    })
    expect(result.buildable).toEqual(['onlyDebug'])
    expect(result.hiddenSelected).toEqual([])
  })

  it('变体改名后留下的旧勾选算 unknownSelected，不能报成 debug', () => {
    const result = resolveBuildableVariants({
      variants: mixed,
      selected: ['freeRelease', 'removedVariant'],
      includeDebug: false
    })
    expect(result.buildable).toEqual(['freeRelease'])
    expect(result.hiddenSelected).toEqual([])
    expect(result.unknownSelected).toEqual(['removedVariant'])
  })

  it('构建顺序跟随勾选顺序，便于对照界面', () => {
    const result = resolveBuildableVariants({
      variants: mixed,
      selected: ['freeRelease', 'demo_flavorRelease'],
      includeDebug: false
    })
    expect(result.buildable).toEqual(['freeRelease', 'demo_flavorRelease'])
  })
})
