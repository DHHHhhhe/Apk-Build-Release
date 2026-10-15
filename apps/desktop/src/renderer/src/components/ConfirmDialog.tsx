import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

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
  // Esc、点遮罩、焦点陷阱与焦点归还都在 Dialog 里，这里只管内容
  return (
    <Dialog open={open} role="alertdialog" label={title} className="dialog--narrow" onClose={onCancel}>
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
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button variant={tone === 'destructive' ? 'destructive' : 'outline'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </footer>
    </Dialog>
  )
}