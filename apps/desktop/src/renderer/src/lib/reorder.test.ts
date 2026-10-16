import { describe, expect, it } from 'vitest'
import { indexForPointer, moveItemTo } from './reorder'

const ids = (list: Array<{ id: string }>): string[] => list.map((item) => item.id)
const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

describe('拖拽排序：把某一项搬到目标下标', () => {
  it('往后搬', () => {
    expect(ids(moveItemTo(items, 0, 2))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('往前搬', () => {
    expect(ids(moveItemTo(items, 3, 1))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('原地不动时原样返回（同一个引用，避免无谓重渲染）', () => {
    expect(moveItemTo(items, 2, 2)).toBe(items)
  })

  it('下标越界时原样返回', () => {
    expect(moveItemTo(items, -1, 2)).toBe(items)
    expect(moveItemTo(items, 9, 2)).toBe(items)
  })

  it('目标下标超出范围时夹到两端', () => {
    expect(ids(moveItemTo(items, 0, 99))).toEqual(['b', 'c', 'd', 'a'])
    expect(ids(moveItemTo(items, 3, -5))).toEqual(['d', 'a', 'b', 'c'])
  })

  it('不修改传入的数组', () => {
    moveItemTo(items, 0, 2)
    expect(ids(items)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('拖拽排序：指针落在第几位', () => {
  // 四项的中点
  const mids = [50, 150, 250, 350]

  it('指针在第一项中点之上 → 第 0 位', () => {
    expect(indexForPointer(mids, 10)).toBe(0)
  })

  it('越过第一项中点 → 第 1 位', () => {
    expect(indexForPointer(mids, 60)).toBe(1)
  })

  it('越到最后一项中点之下 → 末尾', () => {
    expect(indexForPointer(mids, 999)).toBe(4)
  })

  it('正好落在中点上算「未越过」，不会来回抖', () => {
    expect(indexForPointer(mids, 150)).toBe(1)
    expect(indexForPointer(mids, 150.1)).toBe(2)
  })

  it('空列表返回 0', () => {
    expect(indexForPointer([], 100)).toBe(0)
  })
})