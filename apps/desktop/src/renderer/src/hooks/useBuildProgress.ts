import { useEffect, useState } from 'react'
import type { BuildProgress } from '@shared/types/build'

/**
 * 全局订阅构建进度，按 runId 收。
 *
 * 为什么不挂在 useBuild 里：队列面板（主列）与构建记录（抽屉）都要用，
 * 两边各订一次会重复处理同一批事件；这一层订阅一次，按 props 往下传。
 *
 * 只保留运行中的条目：跑完的进度没有意义，而 runId 会不断新增，
 * 不清掉的话这个 map 会随构建次数无限增长。
 */
export function useBuildProgress(): Record<string, BuildProgress> {
  const [progress, setProgress] = useState<Record<string, BuildProgress>>({})

  useEffect(() => {
    const unsubscribeProgress = window.api.build.onProgress((event) => {
      setProgress((previous) => ({ ...previous, [event.runId]: event }))
    })

    // 用「变体结束」作为清理信号：build:state 里非 running 就是这一条跑完了
    const unsubscribeState = window.api.build.onState((event) => {
      if (event.state === 'running') {
        return
      }
      setProgress((previous) => {
        if (!(event.runId in previous)) {
          return previous
        }
        const next = { ...previous }
        delete next[event.runId]
        return next
      })
    })

    return () => {
      unsubscribeProgress()
      unsubscribeState()
    }
  }, [])

  return progress
}
