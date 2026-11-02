import { describe, expect, it } from 'vitest'
import { nextSortOrder } from './sort-order'

describe('新项目的排序位', () => {
  it('老库（全都没排过）时拿 0，排在所有 NULL 之后', () => {
    // SQLite 的 ORDER BY 把 NULL 排在最前，所以 0 一定在它们后面
    expect(nextSortOrder([null, null, null])).toBe(0)
    expect(nextSortOrder([])).toBe(0)
  })

  it('已经手工排过时排在最后一项之后', () => {
    expect(nextSortOrder([0, 1, 2])).toBe(3)
    expect(nextSortOrder([2, 0, 1])).toBe(3)
  })

  it('排序位有空洞时取最大值加一，不会插到中间', () => {
    expect(nextSortOrder([0, 5, 9])).toBe(10)
  })

  it('新旧混在一起（部分 NULL）时也排在已排序的那些之后', () => {
    expect(nextSortOrder([null, 0, null, 1])).toBe(2)
  })

  it('负值（历史脏数据）也按最大值推进', () => {
    expect(nextSortOrder([-5, -2])).toBe(-1)
  })

  it('全负但含 0 时按 0 推进', () => {
    expect(nextSortOrder([-5, 0])).toBe(1)
  })
})
