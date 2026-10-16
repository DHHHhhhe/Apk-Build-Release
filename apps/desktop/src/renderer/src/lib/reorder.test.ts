import { describe, expect, it } from 'vitest'
import { previewReorder } from './reorder'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
const ids = (list: Array<{ id: string }>): string[] => list.map((item) => item.id)

describe('拖动过程中的预览顺序', () => {
  // 语义与既有的 dropOn 一致：插到目标项**前面**（HTML5 拖放的常规行为）
  it('把拖动的项插到目标项前面', () => {
    expect(ids(previewReorder(items, 'a', 'c'))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('往后拖也一样（目标项前插）', () => {
    expect(ids(previewReorder(items, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('没有拖动时原样返回', () => {
    expect(ids(previewReorder(items, null, 'c'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(previewReorder(items, 'a', null))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('拖到自己身上不变', () => {
    expect(ids(previewReorder(items, 'b', 'b'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('目标或拖动项不在列表里时原样返回（不制造空位）', () => {
    expect(ids(previewReorder(items, 'zz', 'c'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(previewReorder(items, 'a', 'zz'))).toEqual(['a', 'b', 'c', 'd'])
  })
})