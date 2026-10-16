import { useCallback, useState } from 'react'
import { DRAWER_DRAG_MAX, DRAWER_DRAG_MIN } from '../lib/layout'

/** 抽屉宽度的存储键 */
export const DRAWER_WIDTH_STORAGE_KEY = 'abr.drawerWidth'

export function clampDrawerWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DRAWER_DRAG_MIN
  }
  return Math.min(DRAWER_DRAG_MAX, Math.max(DRAWER_DRAG_MIN, Math.round(value)))
}

/**
 * 读出用户拖过的宽度。
 *
 * 没存过返回 `null` 而不是某个默认值 —— 「没拖过」与「拖到了 380」是两回事：
 * 前者要按窗口宽度算比例宽度，后者要尊重用户的选择。
 */
export function readStoredDrawerWidth(storage: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = storage.getItem(DRAWER_WIDTH_STORAGE_KEY)
    if (raw === null || raw.trim() === '') {
      return null
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampDrawerWidth(parsed) : null
  } catch {
    // localStorage 在隐私模式或被策略禁用时访问即抛，读不到就当没存过
    return null
  }
}

export interface UseDrawerWidthResult {
  /** 用户偏好的宽度；null = 没拖过，按窗口比例算 */
  preferredWidth: number | null
  /** 拖动中：立即生效，不落盘 */
  setWidth: (value: number) => void
  /** 松手或键盘调整结束：落盘，下次打开还是这个宽度 */
  commitWidth: (value: number) => void
}

/**
 * 抽屉宽度由 App 持有。
 *
 * 以前它藏在 ProjectDrawer 里，于是「主列要不要避让」按布局常量算（1280 下 512）、
 * 抽屉自己按用户拖的值画（默认 560）—— 两个数不一致时避让也白搭。
 * 宽度提升到布局层，两者才能用同一个数（见 resolveDrawerLayout）。
 */
export function useDrawerWidth(): UseDrawerWidthResult {
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      return readStoredDrawerWidth(window.localStorage)
    } catch {
      return null
    }
  })

  const setWidth = useCallback((value: number): void => {
    setPreferredWidth(clampDrawerWidth(value))
  }, [])

  const commitWidth = useCallback((value: number): void => {
    const next = clampDrawerWidth(value)
    setPreferredWidth(next)
    try {
      window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(next))
    } catch {
      // 存不下就算了：这次会话里宽度仍然是对的，只是下次打开回到比例宽度
    }
  }, [])

  return { preferredWidth, setWidth, commitWidth }
}
