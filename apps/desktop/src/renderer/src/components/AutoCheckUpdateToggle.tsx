import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/button'

/**
 * 「启动时自动检查更新」开关。
 *
 * 状态自带，不放进全局 store：它只在左下角这一处出现，而且是主进程说了算的一份落盘偏好，
 * 提上去反而多一层要同步的副本。
 *
 * 首次读盘之前开关是**禁用**的（enabled 为 null）—— 比起先渲染成「关」再跳成「开」，
 * 短暂禁用一下不会骗人。
 */
export function AutoCheckUpdateToggle(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.settings.get().then((result) => {
      if (!alive) {
        return
      }
      // 读不出来就保持禁用，别让用户以为现在是「关」
      setEnabled(result.settings ? result.settings.autoCheckUpdate : null)
    })
    return () => {
      alive = false
    }
  }, [])

  const apply = useCallback(async (next: boolean): Promise<void> => {
    // 先动界面再落盘：写的是本地数据库，几乎不会失败，等 IPC 回来才动开关会有一下明显迟滞
    setEnabled(next)
    const result = await window.api.settings.setAutoCheckUpdate(next)
    if (!result.success) {
      // 写失败就退回原值，不让界面显示一个跟库里不一样的状态
      setEnabled(!next)
      return
    }
    if (result.settings) {
      setEnabled(result.settings.autoCheckUpdate)
    }
  }, [])

  const on = enabled === true

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="启动时自动检查更新"
      title={on ? '启动时会自动查一次；关掉后只有手动点才查' : '启动时不会自动查；手动点仍然可以'}
      className={on ? 'switch switch--on' : 'switch'}
      disabled={enabled === null}
      onClick={() => {
        void apply(!on)
      }}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  )
}
