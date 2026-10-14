import { useCallback, useEffect, useState } from 'react'
import type { ThemeChoice } from '@shared/types/settings'
import { applyThemeClass, prefersDark, watchTheme } from '../lib/theme'

export interface ThemeApi {
  /** 用户选的档位（跟随系统 / 浅色 / 深色），不是当前显示出来的深浅 */
  theme: ThemeChoice
  busy: boolean
  error: string | null
  setTheme: (choice: ThemeChoice) => Promise<void>
}

/**
 * 主题档位。档位本身只用来点亮切换控件 —— 界面深浅由主进程的 themeSource 决定，
 * 渲染层只跟着媒体查询挂 `.dark` 类（见 lib/theme.ts）。
 */
export function useTheme(): ThemeApi {
  const [theme, setChoice] = useState<ThemeChoice>('system')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 系统切换深色、或用户改了档位（主进程改了 themeSource），都会让媒体查询变化
  useEffect(() => {
    const sync = (): void => {
      applyThemeClass(prefersDark())
    }
    sync()
    return watchTheme(sync)
  }, [])

  useEffect(() => {
    let alive = true
    void window.api.settings.get().then((result) => {
      if (alive && result.settings) {
        setChoice(result.settings.theme)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const setTheme = useCallback(
    async (choice: ThemeChoice): Promise<void> => {
      setBusy(true)
      setError(null)
      const previous = theme
      // 先点亮选中的那一档；深浅随后由主进程改 themeSource 带动
      setChoice(choice)

      const result = await window.api.settings.setTheme(choice)
      setBusy(false)
      if (!result.success) {
        setChoice(previous)
        setError(result.error ?? '切换主题失败')
        return
      }
      if (result.settings) {
        setChoice(result.settings.theme)
      }
      // 媒体查询的更新可能落在下一帧，补一次兜底
      window.requestAnimationFrame(() => {
        applyThemeClass(prefersDark())
      })
    },
    [theme]
  )

  return { theme, busy, error, setTheme }
}
