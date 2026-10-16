import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { FolderOpen, Trash2, X } from 'lucide-react'
import type { Settings } from '@shared/types/settings'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog } from './ui/dialog'
import { openPathOrToast } from '../lib/open-path'

export function SettingsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingClose, setPendingClose] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    void window.api.settings.get().then((result) => {
      if (result.settings) {
        setSettings(result.settings)
        setDraft(result.settings.outputRoot)
      }
    })
  }, [open])

  // 关掉再打开要回到干净状态，否则上一轮的「有未保存的改动」会跟着进来
  useEffect(() => {
    if (!open) {
      setPendingClose(false)
      setMessage(null)
      setError(null)
    }
  }, [open])

  if (!open) {
    return null
  }

  /*
   * 输入框里的值与已保存的值不一致就是「有未保存的改动」。
   * 以前这条没有任何提示：改完目录直接关掉，改动静默丢失，下次打开还是旧值。
   */
  const dirty = settings !== null && draft !== settings.outputRoot

  const apply = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    const result = await window.api.settings.setOutputRoot(draft)
    if (!result.success) {
      setError(result.error ?? '保存失败')
      return
    }
    if (result.settings) {
      setSettings(result.settings)
      setDraft(result.settings.outputRoot)
    }
    setMessage('已保存')
  }

  const pick = async (): Promise<void> => {
    setError(null)
    const result = await window.api.settings.pickOutputDir()
    if (!result.success) {
      setError(result.error ?? '选择失败')
      return
    }
    if (result.settings) {
      setSettings(result.settings)
      setDraft(result.settings.outputRoot)
      setMessage('已保存')
    }
  }

  const clearLogs = async (): Promise<void> => {
    setError(null)
    const result = await window.api.settings.clearLogs()
    if (!result.success) {
      setError(result.error ?? '清理失败')
      return
    }
    const mb = ((result.freedBytes ?? 0) / 1024 / 1024).toFixed(1)
    setMessage(`已清理 ${result.removed ?? 0} 个日志文件，释放 ${mb} MB`)
  }

  /** 关闭前拦一道：有未保存的改动时先说清会丢掉什么 */
  const requestClose = (): void => {
    if (dirty) {
      setPendingClose(true)
      return
    }
    onClose()
  }

  return (
    <>
      <Dialog open={open} label="设置" onClose={requestClose}>
        <header className="dialog__head">
          <h2 className="dialog__title">设置</h2>
          <Button variant="ghost" aria-label="关闭设置" onClick={requestClose}>
            <X size={16} aria-hidden="true" />
          </Button>
        </header>

        <div className="dialog__body">
          <label className="dialog__field">
            <span className="dialog__label">统一输出目录</span>
            <div className="dialog__row">
              <input
                className="input"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                aria-label="统一输出目录"
              />
              <Button variant="ghost" onClick={() => void pick()}>
                选择…
              </Button>
              <Button
                variant={dirty ? 'default' : 'ghost'}
                disabled={!dirty}
                onClick={() => void apply()}
              >
                保存
              </Button>
            </div>
            {dirty ? (
              <span className="dialog__dirty" role="status" aria-live="polite">
                有未保存的改动，关掉这一页就会丢掉
              </span>
            ) : (
              <span className="dialog__hint">构建出的 APK 会按项目名（或别名）复制到这个目录下</span>
            )}
          </label>

          <div className="dialog__field">
            <span className="dialog__label">构建日志</span>
            <div className="dialog__row">
              <span className="dialog__value tabular">{settings?.logDir ?? '（读取中）'}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  void openPathOrToast(settings?.logDir ?? '', '日志目录')
                }}
              >
                <FolderOpen size={14} aria-hidden="true" />
                打开
              </Button>
              <Button variant="ghost" onClick={() => void clearLogs()}>
                <Trash2 size={14} aria-hidden="true" />
                清理日志
              </Button>
            </div>
          </div>

          {message ? (
            <p className="dialog__message" role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="dialog__error" role="status" aria-live="polite">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingClose}
        title="放弃未保存的改动？"
        message="统一输出目录改成了新的值但还没保存，关掉设置页这次修改就丢了。"
        confirmLabel="放弃改动"
        tone="destructive"
        onCancel={() => {
          setPendingClose(false)
        }}
        onConfirm={() => {
          setPendingClose(false)
          onClose()
        }}
      />
    </>
  )
}
