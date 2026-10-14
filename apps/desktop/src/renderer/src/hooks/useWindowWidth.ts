import { useEffect, useState } from 'react'

/**
 * 当前窗口宽度。
 *
 * 抽屉是否让主列避让，要按**实际**窗口宽度判断 —— 侧栏宽度是用户可拖的，
 * 用 CSS 媒体查询写死阈值会与实际不符。
 *
 * 用 window 的 resize 而不是某个元素的 ResizeObserver：这里关心窗口本身，
 * 观察元素会把「抽屉打开引起的内容列变化」也算成一次尺寸变化，绕回来影响自己的判断。
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const handleResize = (): void => {
      setWidth(window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return width
}
