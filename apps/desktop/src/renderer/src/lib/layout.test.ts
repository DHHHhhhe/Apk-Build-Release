import { describe, expect, it } from 'vitest'
import {
  DRAWER_DRAG_MAX,
  DRAWER_MIN_WIDTH,
  MAIN_MIN_WIDTH,
  preferredDrawerWidth,
  resolveDrawerLayout
} from './layout'

const sidebarWidth = 272

describe('preferredDrawerWidth', () => {
  it('中间尺寸按比例缩放', () => {
    expect(preferredDrawerWidth(1200)).toBe(480)
  })

  it('小窗口不低过下限', () => {
    expect(preferredDrawerWidth(1024)).toBe(DRAWER_MIN_WIDTH)
    expect(preferredDrawerWidth(800)).toBe(DRAWER_MIN_WIDTH)
  })

  it('大窗口封顶，不会一直变宽把内容挤没', () => {
    expect(preferredDrawerWidth(1600)).toBe(560)
    expect(preferredDrawerWidth(2560)).toBe(560)
  })
})

describe('resolveDrawerLayout', () => {
  it('默认的 1280 窗口：避让，抽屉取比例宽度（比可用空间小就不必压）', () => {
    const layout = resolveDrawerLayout({ windowWidth: 1280, sidebarWidth })
    expect(layout.mode).toBe('avoid')
    expect(layout.width).toBe(preferredDrawerWidth(1280))
    // 避让后主列仍在地板之上，这才是避让的意义
    expect(1280 - sidebarWidth - layout.width).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH)
  })

  it('避让后主列宽度不低于地板（这是避让的意义）', () => {
    const layout = resolveDrawerLayout({ windowWidth: 1280, sidebarWidth })
    expect(1280 - sidebarWidth - layout.width).toBeGreaterThanOrEqual(MAIN_MIN_WIDTH)
  })

  it('用户把抽屉拖到 900：仍然要压回可用空间，不能拖出去就把主列挤穿', () => {
    const layout = resolveDrawerLayout({ windowWidth: 1280, sidebarWidth, preferredWidth: DRAWER_DRAG_MAX })
    expect(layout.mode).toBe('avoid')
    expect(layout.width).toBe(1280 - sidebarWidth - MAIN_MIN_WIDTH)
  })

  it('最小窗口 1024：连下限都放不下，转为覆盖模式，宽度不把主列盖满', () => {
    const layout = resolveDrawerLayout({ windowWidth: 1024, sidebarWidth })
    expect(layout.mode).toBe('overlap')
    expect(layout.width).toBe(DRAWER_MIN_WIDTH)
    // 抽屉左边至少留出主列的一段，用户还能看到并操作主列左侧
    expect(1024 - layout.width).toBeGreaterThan(0)
  })

  it('覆盖模式下拖宽也受「留给主列多少」约束，不会盖满整屏', () => {
    const layout = resolveDrawerLayout({
      windowWidth: 1024,
      sidebarWidth,
      preferredWidth: DRAWER_DRAG_MAX
    })
    expect(layout.mode).toBe('overlap')
    expect(layout.width).toBe(1024 - sidebarWidth - 320)
    expect(layout.width).toBeLessThan(DRAWER_DRAG_MAX)
  })

  it('覆盖模式下主列可见宽度不低于可操作下限（否则按钮全被压在抽屉底下）', () => {
    for (const sidebar of [272, 313, 420]) {
      const layout = resolveDrawerLayout({ windowWidth: 1024, sidebarWidth: sidebar })
      expect(1024 - sidebar - layout.width).toBeGreaterThanOrEqual(200)
    }
  })

  it('窗口越宽越倾向避让，且宽度最终回到用户偏好', () => {
    const layout = resolveDrawerLayout({ windowWidth: 1600, sidebarWidth })
    expect(layout.mode).toBe('avoid')
    expect(layout.width).toBe(560)
  })

  it('侧栏被拖宽后，原本够用的窗口会转为覆盖 —— 阈值必须跟着实际侧栏宽走', () => {
    expect(resolveDrawerLayout({ windowWidth: 1280, sidebarWidth: 272 }).mode).toBe('avoid')
    expect(resolveDrawerLayout({ windowWidth: 1280, sidebarWidth: 500 }).mode).toBe('overlap')
  })

  it('刚好等于主列地板时避让（开区间），少 1px 就转覆盖', () => {
    // 令 available 恰好等于 DRAWER_MIN_WIDTH，即刚好放得下
    const windowWidth = sidebarWidth + DRAWER_MIN_WIDTH + MAIN_MIN_WIDTH
    expect(resolveDrawerLayout({ windowWidth, sidebarWidth }).mode).toBe('avoid')
    expect(resolveDrawerLayout({ windowWidth: windowWidth - 1, sidebarWidth }).mode).toBe('overlap')
  })
})
