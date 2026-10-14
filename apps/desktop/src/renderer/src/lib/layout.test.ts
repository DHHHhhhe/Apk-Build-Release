import { describe, expect, it } from 'vitest'
import {
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  MAIN_MIN_WIDTH,
  resolveDrawerWidth,
  shouldAvoidDrawer
} from './layout'

describe('resolveDrawerWidth', () => {
  it('中间尺寸按比例缩放', () => {
    expect(resolveDrawerWidth(1200)).toBe(480)
  })

  it('小窗口不低过下限', () => {
    expect(resolveDrawerWidth(1024)).toBe(DRAWER_MIN_WIDTH)
    expect(resolveDrawerWidth(800)).toBe(DRAWER_MIN_WIDTH)
  })

  it('大窗口封顶，不会一直变宽把内容挤没', () => {
    expect(resolveDrawerWidth(1600)).toBe(DRAWER_MAX_WIDTH)
    expect(resolveDrawerWidth(2560)).toBe(DRAWER_MAX_WIDTH)
  })
})

describe('shouldAvoidDrawer', () => {
  const sidebarWidth = 272

  it('默认的 1280 窗口下避让：这是默认窗口，不避让就等于默认状态遮住主列右侧', () => {
    expect(shouldAvoidDrawer({ windowWidth: 1280, sidebarWidth })).toBe(true)
  })

  it('最小窗口 1024 下宁可盖住：避让后主列只剩三百多像素，没法用', () => {
    expect(shouldAvoidDrawer({ windowWidth: 1024, sidebarWidth })).toBe(false)
  })

  it('窗口越宽越倾向避让', () => {
    expect(shouldAvoidDrawer({ windowWidth: 1600, sidebarWidth })).toBe(true)
    expect(shouldAvoidDrawer({ windowWidth: 2000, sidebarWidth })).toBe(true)
  })

  it('侧栏被拖宽后，原本够用的窗口会转为盖住 —— 阈值必须跟着实际侧栏宽走', () => {
    expect(shouldAvoidDrawer({ windowWidth: 1280, sidebarWidth: 272 })).toBe(true)
    expect(shouldAvoidDrawer({ windowWidth: 1280, sidebarWidth: 500 })).toBe(false)
  })

  it('刚好等于主列最小宽时避让（开区间）', () => {
    const windowWidth = 1400
    const drawerWidth = resolveDrawerWidth(windowWidth)
    expect(
      shouldAvoidDrawer({
        windowWidth: sidebarWidth + drawerWidth + MAIN_MIN_WIDTH,
        sidebarWidth,
        drawerWidth
      })
    ).toBe(true)
    expect(
      shouldAvoidDrawer({
        windowWidth: sidebarWidth + drawerWidth + MAIN_MIN_WIDTH - 1,
        sidebarWidth,
        drawerWidth
      })
    ).toBe(false)
  })
})
