import { describe, expect, it } from 'vitest'
import { dragMargin, edgeScrollStep, indexForPointer, moveItemTo } from './reorder'

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

describe('拖拽排序：换位死区', () => {
  it('普通行高下死区很小（换位行程约等于一整行）', () => {
    // 90px 的行：死区 9px，越过中点再走 9px 就换位 —— 合计约 54px
    expect(dragMargin(90)).toBe(9)
    expect(dragMargin(90)).toBeLessThan(90 / 2)
  })

  it('行很高时也不放大到半行', () => {
    expect(dragMargin(400)).toBe(10)
  })

  it('行很矮时仍有最小死区，避免分界线上来回蹭', () => {
    expect(dragMargin(12)).toBe(4)
  })

  it('行高未知（0）时给最小死区', () => {
    expect(dragMargin(0)).toBe(4)
  })

  it('死区能把「刚过中点」判成不换位、再走一点才换位', () => {
    const mids = [50, 150]
    const margin = dragMargin(90)
    expect(indexForPointer(mids, 150, margin)).toBe(1)
    expect(indexForPointer(mids, 150 + margin, margin)).toBe(1)
    expect(indexForPointer(mids, 150 + margin + 1, margin)).toBe(2)
  })
})

describe('拖拽排序：指针贴边时的自动滚动', () => {
  const box = { top: 100, bottom: 500 }

  it('指针在中间不滚', () => {
    expect(edgeScrollStep(300, box, 48, 14)).toBe(0)
  })

  it('指针在边缘区外不滚', () => {
    // 边缘区是 100~148 与 452~500，取两段之外的点
    expect(edgeScrollStep(160, box, 48, 14)).toBe(0)
    expect(edgeScrollStep(440, box, 48, 14)).toBe(0)
  })

  it('靠近下边缘向下滚，贴到底时是全速', () => {
    const near = edgeScrollStep(480, box, 48, 14)
    const atEdge = edgeScrollStep(500, box, 48, 14)
    expect(near).toBeGreaterThan(0)
    expect(atEdge).toBe(14)
    expect(atEdge).toBeGreaterThan(near)
  })

  it('靠近上边缘向上滚，贴到顶时是全速', () => {
    expect(edgeScrollStep(120, box, 48, 14)).toBeLessThan(0)
    expect(edgeScrollStep(100, box, 48, 14)).toBe(-14)
  })

  it('越界（指针跑到容器外）也按全速滚，不会变成 0', () => {
    expect(edgeScrollStep(520, box, 48, 14)).toBe(14)
    expect(edgeScrollStep(60, box, 48, 14)).toBe(-14)
  })

  it('边缘区或步长为 0 时不滚（避免除零与死循环）', () => {
    expect(edgeScrollStep(500, box, 0, 14)).toBe(0)
    expect(edgeScrollStep(500, box, 48, 0)).toBe(0)
  })
})
