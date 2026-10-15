import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420
export const SIDEBAR_DEFAULT = 272
/** DESIGN.md 指定的键名，重开窗口要还原 */
export const SIDEBAR_STORAGE_KEY = 'sidebar-width'

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return SIDEBAR_DEFAULT
  }
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)))
}

export function readStoredWidth(storage: Pick<Storage, 'getItem'>): number {
  const raw = storage.getItem(SIDEBAR_STORAGE_KEY)
  if (raw === null || raw.trim() === '') {
    return SIDEBAR_DEFAULT
  }
  const parsed = Number.parseInt(raw, 10)
  return clampSidebarWidth(parsed)
}

export interface UseSidebarWidthResult {
  width: number
  resizing: boolean
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  /** 键盘调宽：拖拽不能是唯一手段（WCAG 2.5.7），与抽屉把手用同一套键位 */
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/** 侧栏宽度可拖动，松手落 localStorage；重开窗口保持（DESIGN.md 第 4 节） */
export function useSidebarWidth(): UseSidebarWidthResult {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') {
      return SIDEBAR_DEFAULT
    }
    return readStoredWidth(window.localStorage)
  })
  const [resizing, setResizing] = useState(false)
  const startRef = useRef({ x: 0, width: SIDEBAR_DEFAULT })

  /**
   * 松手才写盘。拖动过程中每一帧都写一次 localStorage 是没必要的开销，
   * 而且隐私模式或被策略禁用时 setItem 会抛异常 —— 写不进去也不该让界面崩。
   * 与抽屉把手同一套做法。
   */
  const rememberWidth = useCallback((value: number): void => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(value))
    } catch {
      // 存储不可用时忽略：宽度只在本次会话内有效，界面照常能用
    }
  }, [])

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      startRef.current = { x: event.clientX, width }
      setResizing(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [width]
  )

  useEffect(() => {
    if (!resizing) {
      return
    }

    // 拖动时全窗口都保持 col-resize，鼠标移出侧栏也不会跳回默认指针
    document.body.classList.add('is-resizing-sidebar')

    // 拖动中只更新界面，松手时才写盘
    let latest = startRef.current.width
    const handleMove = (event: PointerEvent): void => {
      const delta = event.clientX - startRef.current.x
      latest = clampSidebarWidth(startRef.current.width + delta)
      setWidth(latest)
    }
    const handleUp = (): void => {
      setResizing(false)
      rememberWidth(latest)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      document.body.classList.remove('is-resizing-sidebar')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [resizing, rememberWidth])

  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    // 左箭头把侧栏推宽（把手在右边），与抽屉那把手的语义一致
    const step = event.key === 'ArrowLeft' ? 16 : -16
    const next = clampSidebarWidth(width + step)
    setWidth(next)
    // 键盘没有「松手」，改一次就落一次
    rememberWidth(next)
  }, [width, rememberWidth])

  return { width, resizing, onResizeStart, onResizeKeyDown }
}
