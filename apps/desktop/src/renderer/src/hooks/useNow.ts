import { useEffect, useState } from 'react'

/**
 * 每秒跳一次的当前时间，用于让「正在构建」的耗时逐秒往上走。
 * 没有东西在跑时不挂定时器（active=false），避免无意义的整树重渲染。
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) {
      return
    }
    setNow(Date.now())
    const timer = setInterval(() => {
      setNow(Date.now())
    }, intervalMs)
    return () => {
      clearInterval(timer)
    }
  }, [active, intervalMs])

  return now
}
