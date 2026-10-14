import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types/update'

export interface UseUpdateResult {
  /** 还没拿到主进程的第一份快照前为 null */
  state: UpdateState | null
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
}

/**
 * 更新状态。
 *
 * 真值在主进程（它跑 electron-updater），这里只做两件事：拿一份当前快照、订阅后续变化。
 * 界面不缓存判断逻辑 —— 比如「该不该显示提示条」由 phase 决定，不在这里推断。
 */
export function useUpdate(): UseUpdateResult {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.update.getState().then((initial) => {
      if (alive) {
        setState(initial)
      }
    })
    const unsubscribe = window.api.update.onState((next) => {
      setState(next)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    setState(await window.api.update.check())
  }, [])

  const download = useCallback(async () => {
    setState(await window.api.update.download())
  }, [])

  const install = useCallback(async () => {
    await window.api.update.install()
  }, [])

  return { state, check, download, install }
}
