import { useEffect, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { LaunchNotice } from '@shared/types/update'

/**
 * 纯告知类通知条的自动关闭时长。
 *
 * 取 7 秒的依据：资料给出的建议是「纯信息 5–7 秒、最短不少于 5 秒」（Fluent 2 默认 7 秒，
 * React Aria 的可访问性下限 5 秒）。这类提示最怕「读一半就没了」。
 */
const AUTO_HIDE_MS = 7000

/**
 * 「已更新到 vX」。
 *
 * 静默安装那几十秒应用是关着的、看不到任何界面，所以重开时要告诉用户刚才那下成了、
 * 以及从哪一版来的。**取一次就没了**（主进程侧的 consume 语义）。
 *
 * 无障碍上的三点（都是「会消失的通知条」最容易漏的）：
 * 1. `role="status"`（等价 aria-live="polite"）：屏幕阅读器闲时播报，不打断当前朗读
 * 2. hover / 聚焦 / 窗口不可见时**暂停**关闭计时 —— 正在读的时候不该消失
 * 3. 必须有显式关闭按钮，且这条信息在「更新记录」里还能再看（不依赖这条会消失的提示）
 */
export function UpdateNoticeToast({
  onOpenChangelog
}: {
  onOpenChangelog: () => void
}): React.JSX.Element | null {
  const [notice, setNotice] = useState<LaunchNotice | null>(null)
  const [paused, setPaused] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.update.takeLaunchNotice().then((value) => {
      if (alive) {
        setNotice(value)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onVisibility = (): void => {
      setHidden(document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!notice || paused || hidden) {
      return
    }
    const timer = window.setTimeout(() => {
      setNotice(null)
    }, AUTO_HIDE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [notice, paused, hidden])

  if (!notice) {
    return null
  }

  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        setPaused(true)
      }}
      onMouseLeave={() => {
        setPaused(false)
      }}
      onFocus={() => {
        setPaused(true)
      }}
      onBlur={() => {
        setPaused(false)
      }}
    >
      <span className="toast__icon" aria-hidden="true">
        <Sparkles size={16} />
      </span>
      <div className="toast__body">
        <p className="toast__title">
          已更新到 <span className="tabular">v{notice.to}</span>
        </p>
        <p className="toast__hint">
          {notice.from ? `上一版是 v${notice.from}。` : '这是第一次带上版本记录的启动。'}
        </p>
        <button
          type="button"
          className="toast__link"
          onClick={() => {
            setNotice(null)
            onOpenChangelog()
          }}
        >
          看更新记录
        </button>
      </div>
      <button
        type="button"
        className="toast__close"
        aria-label="关闭"
        onClick={() => {
          setNotice(null)
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
