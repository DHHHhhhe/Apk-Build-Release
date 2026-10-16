import { describe, expect, it } from 'vitest'
import { sortRunsByDeclaredOrder } from './run-order'

const run = (variant: string, startedAt: number): { variant: string; startedAt: number } => ({ variant, startedAt })
const names = (runs: Array<{ variant: string }>): string[] => runs.map((item) => item.variant)

describe('变体构建记录的展示顺序', () => {
  it('按声明的变体顺序排，而不是按开始时间', () => {
    const runs = [run('paidRelease', 300), run('demoRelease', 100), run('freeRelease', 200)]
    expect(names(sortRunsByDeclaredOrder(runs, ['demoRelease', 'freeRelease', 'paidRelease']))).toEqual([
      'demoRelease',
      'freeRelease',
      'paidRelease'
    ])
  })

  it('同一毫秒创建的 run 顺序稳定（反复排结果一致）', () => {
    const runs = [run('b', 100), run('a', 100), run('c', 100)]
    const declared = ['a', 'b', 'c']
    const first = names(sortRunsByDeclaredOrder(runs, declared))
    const second = names(sortRunsByDeclaredOrder([...runs].reverse(), declared))
    expect(first).toEqual(['a', 'b', 'c'])
    expect(second).toEqual(first)
  })

  it('重试新建的 run 回到它原本的位置，而不是跑到最后', () => {
    const runs = [run('demoRelease', 100), run('freeRelease', 200), run('paidRelease', 900)]
    expect(names(sortRunsByDeclaredOrder(runs, ['demoRelease', 'freeRelease', 'paidRelease']))).toEqual([
      'demoRelease',
      'freeRelease',
      'paidRelease'
    ])
  })

  it('不在声明列表里的 run 排到最后，并按开始时间稳定排列', () => {
    const runs = [run('ghost', 500), run('demoRelease', 100), run('other', 300)]
    expect(names(sortRunsByDeclaredOrder(runs, ['demoRelease']))).toEqual(['demoRelease', 'other', 'ghost'])
  })

  it('空列表与单项不出错', () => {
    expect(sortRunsByDeclaredOrder([], ['a'])).toEqual([])
    expect(names(sortRunsByDeclaredOrder([run('a', 1)], ['a']))).toEqual(['a'])
  })
})