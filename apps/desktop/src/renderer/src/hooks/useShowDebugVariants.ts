import { useCallback, useState } from 'react'

const SHOW_DEBUG_KEY = 'show-debug-variants'

function readStored(): boolean {
  try {
    return window.localStorage.getItem(SHOW_DEBUG_KEY) === '1'
  } catch {
    return false
  }
}

export interface UseShowDebugVariantsResult {
  /** 是否把 debug 变体也列出来（默认否：debug 包不对外发布） */
  showDebug: boolean
  toggle: () => void
}

/**
 * 「是否显示 debug 变体」的状态。
 * 放在 App 层是因为它有双重含义：既决定列表显示什么，也决定构建时跳过哪些 ——
 * 列表里没有的变体不会被构建，两处必须用同一个开关。
 */
export function useShowDebugVariants(): UseShowDebugVariantsResult {
  const [showDebug, setShowDebug] = useState(readStored)

  const toggle = useCallback(() => {
    setShowDebug((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SHOW_DEBUG_KEY, next ? '1' : '0')
      } catch {
        // 存不了就只在本次会话生效
      }
      return next
    })
  }, [])

  return { showDebug, toggle }
}
