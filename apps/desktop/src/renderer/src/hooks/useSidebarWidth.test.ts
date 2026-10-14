import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  readStoredWidth,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_STORAGE_KEY
} from './useSidebarWidth'

function fakeStorage(value: string | null): Pick<Storage, 'getItem'> {
  return {
    getItem: (key: string) => (key === SIDEBAR_STORAGE_KEY ? value : null)
  }
}

describe('clampSidebarWidth', () => {
  it('夹在 200..420 之间', () => {
    expect(clampSidebarWidth(150)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(500)).toBe(SIDEBAR_MAX)
    expect(clampSidebarWidth(300)).toBe(300)
  })

  it('取整，避免拖出小数宽度', () => {
    expect(clampSidebarWidth(288.6)).toBe(289)
  })

  it('非法值退回默认宽度', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT)
  })
})

describe('readStoredWidth', () => {
  it('没存过时用默认宽度', () => {
    expect(readStoredWidth(fakeStorage(null))).toBe(SIDEBAR_DEFAULT)
    expect(readStoredWidth(fakeStorage(''))).toBe(SIDEBAR_DEFAULT)
  })

  it('读出来的值同样要夹紧', () => {
    expect(readStoredWidth(fakeStorage('999'))).toBe(SIDEBAR_MAX)
    expect(readStoredWidth(fakeStorage('50'))).toBe(SIDEBAR_MIN)
    expect(readStoredWidth(fakeStorage('340'))).toBe(340)
  })

  it('存的是脏数据时退回默认宽度', () => {
    expect(readStoredWidth(fakeStorage('abc'))).toBe(SIDEBAR_DEFAULT)
  })
})
