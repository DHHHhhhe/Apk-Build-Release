import { describe, expect, it } from 'vitest'
import { decideLaunchNotice } from './launch-notice'

describe('decideLaunchNotice', () => {
  it('首次安装：什么都不提示', () => {
    expect(decideLaunchNotice({ previous: null, current: '1.0.0', hasStoredSettings: false })).toBeNull()
  })

  it('从旧版升上来（有设置但没有版本记录）：提示，但不说「上一版是」', () => {
    expect(decideLaunchNotice({ previous: null, current: '1.0.0', hasStoredSettings: true })).toEqual({
      to: '1.0.0'
    })
  })

  it('正常更新：提示并带上一版', () => {
    expect(decideLaunchNotice({ previous: '0.9.0', current: '1.0.0', hasStoredSettings: true })).toEqual({
      from: '0.9.0',
      to: '1.0.0'
    })
  })

  it('版本没变：不提示（同一版反复启动不该每次都说「已更新」）', () => {
    expect(decideLaunchNotice({ previous: '1.0.0', current: '1.0.0', hasStoredSettings: true })).toBeNull()
  })

  it('记录回退（装了旧版）：也提示，从哪到哪都说清楚', () => {
    expect(decideLaunchNotice({ previous: '1.1.0', current: '1.0.0', hasStoredSettings: true })).toEqual({
      from: '1.1.0',
      to: '1.0.0'
    })
  })
})
