import { describe, expect, it } from 'vitest'
import {
  clampDrawerWidth,
  DRAWER_WIDTH_STORAGE_KEY,
  readStoredDrawerWidth
} from './useDrawerWidth'
import { DRAWER_DRAG_MAX, DRAWER_DRAG_MIN } from '../lib/layout'

function fakeStorage(value: string | null): Pick<Storage, 'getItem'> {
  return {
    getItem: (key: string) => (key === DRAWER_WIDTH_STORAGE_KEY ? value : null)
  }
}

describe('clampDrawerWidth', () => {
  it('夹在拖动范围内', () => {
    expect(clampDrawerWidth(100)).toBe(DRAWER_DRAG_MIN)
    expect(clampDrawerWidth(5000)).toBe(DRAWER_DRAG_MAX)
    expect(clampDrawerWidth(600)).toBe(600)
  })

  it('取整，避免拖出小数宽度', () => {
    expect(clampDrawerWidth(512.4)).toBe(512)
  })

  it('非法值退回下限而不是 NaN', () => {
    expect(clampDrawerWidth(Number.NaN)).toBe(DRAWER_DRAG_MIN)
  })
})

describe('readStoredDrawerWidth', () => {
  it('没存过返回 null：没拖过要按窗口比例算，不是当成 380', () => {
    expect(readStoredDrawerWidth(fakeStorage(null))).toBeNull()
    expect(readStoredDrawerWidth(fakeStorage(''))).toBeNull()
  })

  it('读出来的值同样要夹紧', () => {
    expect(readStoredDrawerWidth(fakeStorage('9999'))).toBe(DRAWER_DRAG_MAX)
    expect(readStoredDrawerWidth(fakeStorage('10'))).toBe(DRAWER_DRAG_MIN)
    expect(readStoredDrawerWidth(fakeStorage('520'))).toBe(520)
  })

  it('存的是脏数据时当没存过', () => {
    expect(readStoredDrawerWidth(fakeStorage('abc'))).toBeNull()
  })

  it('存储不可用时当没存过，不抛异常', () => {
    const throwing: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('denied')
      }
    }
    expect(readStoredDrawerWidth(throwing)).toBeNull()
  })
})
