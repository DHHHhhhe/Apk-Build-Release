import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useUpdate } from '../hooks/useUpdate'

/**
 * 纯告知类通知条的自动关闭时长。取 7 秒的依据与「已更新到」那条一致：
 * 纯信息建议 5–7 秒，最短不少于 5 秒。
 */
const AUTO_HIDE_MS = 7000

/**
 * 手动检查更新之后的结果。
 *
 * 为什么必须有它：「已经是最新」与「检查失败」在**自动**检查时该保持安静（没人问就不该出声），
 * 但**用户自己点了**「检查更新」，那就必须给出回音 —— 点了什么都不发生，用户分不清是
 * 「真的没有新版本」还是「这功能坏了」，只能来报 bug。
 *
 * 自动检查的结果照旧不占位置。
 */
export function UpdateResultToast(): React.JSX.Element | null {
  const update = useUpdate()
  const [visible, setVisible] = useState(false)
  const [paused, setPaused] = useState(false)
  const state = update.state

  // 只在「手动检查」的收尾阶段露头；自动检查那两种结果一律安静
  const kind = state?.manual
    ? state.phase === 'up-to-date'
      ? 'ok'
      : state.phase === 'error'
        ? 'error'
        : null
    : null

  useEffect(() => {
    if (kind) {
      setVisible(true)
    }
  }, [kind, state?.message])

  useEffect(() => {
    if (!visible || paused) {
      return
    }
    const timer = window.setTimeout(() => {
      setVisible(false)
    }, AUTO_HIDE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [visible, paused])

  if (!kind || !visible || !state) {
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
        <RefreshCw size={16} />
      </span>
      <div className="toast__body">
        <p className="toast__title">{kind === 'ok' ? '已经是最新版本。' : '检查更新失败'}</p>
        {kind === 'error' ? <p className="toast__hint">{state.message}</p> : null}
      </div>
      <button
        type="button"
        className="toast__close"
        aria-label="关闭"
        onClick={() => {
          setVisible(false)
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
