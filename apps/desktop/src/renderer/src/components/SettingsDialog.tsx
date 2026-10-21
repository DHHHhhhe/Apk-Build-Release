import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { FolderOpen, Trash2, X } from 'lucide-react'
import type { Settings } from '@shared/types/settings'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog } from './ui/dialog'
import { openPathOrToast } from '../lib/open-path'

export function SettingsDialog({
  open,
  onClose,
  onSaved
}: {
  open: boolean
  onClose: () => void
  /** 设置写成功后的回调：让上层（队列面板）立刻用上新值，不必等关掉对话框再刷新 */
  onSaved?: () => void
}): React.JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState('')
  /** 进度条开关：null = 还没读到，按钮先禁用（别先把「关」显示出来再跳成「开」） */
  const [showProgress, setShowProgress] = useState<boolean | null>(null)
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
        setShowProgress(result.settings.showVariantProgress)
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

  /**
   * 进度条开关：拨动即写，不复用输出目录那个「保存」按钮 ——
   * 布尔开关没有中间态，多一步保存只会让人以为刚才那一下没生效。
   */
  const toggleProgress = async (next: boolean): Promise<void> => {
    setError(null)
    setMessage(null)
    // 先动界面再落盘：写的是本地数据库，几乎不会失败，等 IPC 回来才动开关会有一下明显迟滞
    setShowProgress(next)
    const result = await window.api.settings.setShowVariantProgress(next)
    if (!result.success) {
      setShowProgress(!next)
      setError(result.error ?? '保存失败')
      return
    }
    if (result.settings) {
      setSettings(result.settings)
      setShowProgress(result.settings.showVariantProgress)
    }
    onSaved?.()
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

          <div className="dialog__field">
            <span className="dialog__label">界面</span>
            <div className="dialog__row">
              <button
                type="button"
                role="switch"
                aria-checked={showProgress === true}
                aria-label="显示变体构建进度条"
                className={showProgress === true ? 'switch switch--on' : 'switch'}
                disabled={showProgress === null}
                onClick={() => {
                  void toggleProgress(showProgress !== true)
                }}
              >
                <span className="switch__thumb" aria-hidden="true" />
              </button>
              <span className="dialog__hint">
                队列里正在构建的变体显示进度条，按该变体历史成功构建的耗时中位数预估 ——
                不是 Gradle 的真实进度
              </span>
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
