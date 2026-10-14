import { describe, expect, it } from 'vitest'
import { assembleTaskName, variantTaskPath } from './spawn-gradle'

describe('assembleTaskName', () => {
  it('变体名首字母大写后拼到 assemble 后面', () => {
    expect(assembleTaskName('freeDebug')).toBe('assembleFreeDebug')
    expect(assembleTaskName('demo_flavorRelease')).toBe('assembleDemo_flavorRelease')
    expect(assembleTaskName('Debug')).toBe('assembleDebug')
  })

  it('空变体名退化为 assemble', () => {
    expect(assembleTaskName('')).toBe('assemble')
  })
})

describe('variantTaskPath', () => {
  it('带模块时给出全路径任务', () => {
    expect(variantTaskPath(':app', 'freeRelease')).toBe(':app:assembleFreeRelease')
  })

  it('没有模块信息时退回根任务', () => {
    expect(variantTaskPath(null, 'freeRelease')).toBe('assembleFreeRelease')
  })
})
