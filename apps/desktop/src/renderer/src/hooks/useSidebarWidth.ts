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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width))
  }, [width])

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

    const handleMove = (event: PointerEvent): void => {
      const delta = event.clientX - startRef.current.x
      setWidth(clampSidebarWidth(startRef.current.width + delta))
    }
    const handleUp = (): void => {
      setResizing(false)
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
  }, [resizing])

  return { width, resizing, onResizeStart }
}
