import { useCallback, useEffect, useState } from 'react'
import type { Settings } from '@shared/types/settings'

export interface UseSettingsResult {
  settings: Settings | null
  refresh: () => void
}

/**
 * 读一次设置（目前只用到统一输出目录）。
 *
 * 抽屉里要显示「产物会归档到哪」，这个路径由设置决定；设置对话框改完之后
 * 调用 refresh 重新读一次，两处才不会显示成两个目录。
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.settings
      .get()
      .then((result) => {
        if (!cancelled && result.settings) {
          setSettings(result.settings)
        }
      })
      .catch(() => {
        // 读不到设置不影响主流程：归档预览那一行不显示就是了
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  return { settings, refresh }
}
