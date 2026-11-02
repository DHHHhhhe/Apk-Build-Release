import { describe, expect, it } from 'vitest'
import { scrollTopToReveal } from './reveal'

const box = { boxTop: 100, boxBottom: 400 }

describe('把新项目滚进可视区', () => {
  it('已经完整可见时不动（加一项不该让整列跳一下）', () => {
    expect(
      scrollTopToReveal({ ...box, itemTop: 200, itemBottom: 290, scrollTop: 120, maxScrollTop: 800 })
    ).toBe(120)
  })

  it('在下方看不见时往下滚，刚好把底边推进可视区', () => {
    expect(
      scrollTopToReveal({ ...box, itemTop: 500, itemBottom: 590, scrollTop: 0, maxScrollTop: 800 })
    ).toBe(190)
  })

  it('在上方看不见时往上滚', () => {
    expect(
      scrollTopToReveal({ ...box, itemTop: 40, itemBottom: 130, scrollTop: 300, maxScrollTop: 800 })
    ).toBe(240)
  })

  it('贴边留白：滚到位后目标项与容器边缘还隔着留白', () => {
    expect(
      scrollTopToReveal({
        ...box,
        itemTop: 500,
        itemBottom: 590,
        scrollTop: 0,
        maxScrollTop: 800,
        padding: 8
      })
    ).toBe(198)
  })

  it('结果被夹在 0 与最大可滚之间', () => {
    expect(
      scrollTopToReveal({ ...box, itemTop: 999, itemBottom: 1089, scrollTop: 0, maxScrollTop: 50 })
    ).toBe(50)
    expect(
      scrollTopToReveal({ ...box, itemTop: 0, itemBottom: 20, scrollTop: 10, maxScrollTop: 50 })
    ).toBe(0)
  })

  it('不可滚的容器（maxScrollTop 为 0）永远返回 0', () => {
    expect(
      scrollTopToReveal({ ...box, itemTop: 999, itemBottom: 1089, scrollTop: 0, maxScrollTop: 0 })
    ).toBe(0)
  })
})
