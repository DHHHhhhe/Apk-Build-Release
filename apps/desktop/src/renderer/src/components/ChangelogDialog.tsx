import { useEffect } from 'react'
import { History, X } from 'lucide-react'
import { ChangelogList } from './ChangelogList'

/**
 * 更新记录。入口是左下角那个版本号 —— 想知道「这版改了什么」时，眼睛本来就在找版本号。
 *
 * 内容读的是**打进包里的** CHANGELOG（构建时内联），不走 GitHub API：内网分发的机器
 * 从外面拉列表未必拿得到，而这恰恰是那台机器更需要知道的。
 */
export function ChangelogDialog({
  open,
  currentVersion,
  onClose
}: {
  open: boolean
  currentVersion: string
  onClose: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog--changelog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className="dialog__head">
          <span className="dialog__icon">
            <History size={16} aria-hidden="true" />
          </span>
          <h2 className="dialog__title" id="changelog-title">
            更新记录
          </h2>
          <button type="button" className="dialog__close" aria-label="关闭" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="dialog__body">
          <p className="dialog__hint">当前版本 {currentVersion}。这份记录打进了包里，断网也能看。</p>
          <ChangelogList currentVersion={currentVersion} />
        </div>
      </div>
    </div>
  )
}
