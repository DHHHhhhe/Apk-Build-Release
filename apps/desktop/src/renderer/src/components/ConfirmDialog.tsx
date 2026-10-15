import { useEffect } from 'react'
import { Button } from './ui/button'
import { AlertTriangle } from 'lucide-react'

/** 通用确认对话框：危险操作前用它，说明会发生什么而不是只问「确定吗」 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'default',
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  tone?: 'default' | 'destructive'
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onCancel])

  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog dialog--narrow"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className="dialog__head">
          <span className={tone === 'destructive' ? 'dialog__icon dialog__icon--destructive' : 'dialog__icon'}>
            <AlertTriangle size={16} aria-hidden="true" />
          </span>
          <h2 className="dialog__title">{title}</h2>
        </header>
        <div className="dialog__body">
          <p className="dialog__message-text">{message}</p>
        </div>
        <footer className="dialog__foot">
          <Button  variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <button
            type="button"
            className={tone === 'destructive' ? 'btn-destructive' : 'btn-outline'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}