import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Trash2, X } from 'lucide-react'
import type { Settings } from '@shared/types/settings'
import { useUpdate } from '../hooks/useUpdate'

export function SettingsDialog({
  open,
  onClose,
  busy
}: {
  open: boolean
  onClose: () => void
  /** 队列里有正在跑或排队的项：这时不能重启装更新，会把构建掐掉 */
  busy: boolean
}): React.JSX.Element | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const update = useUpdate()

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

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className="dialog__head">
          <h2 className="dialog__title">设置</h2>
          <button type="button" className="btn-ghost" aria-label="关闭设置" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
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
              <button type="button" className="btn-ghost" onClick={() => void pick()}>
                选择…
              </button>
              <button type="button" className="btn-ghost" onClick={() => void apply()}>
                保存
              </button>
            </div>
            <span className="dialog__hint">构建出的 APK 会按项目名复制到这个目录下</span>
          </label>

          <div className="dialog__field">
            <span className="dialog__label">构建日志</span>
            <div className="dialog__row">
              <span className="dialog__value tabular">{settings?.logDir ?? '（读取中）'}</span>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  void window.api.settings.openPath(settings?.logDir ?? '')
                }}
              >
                <FolderOpen size={14} aria-hidden="true" />
                打开
              </button>
              <button type="button" className="btn-ghost" onClick={() => void clearLogs()}>
                <Trash2 size={14} aria-hidden="true" />
                清理日志
              </button>
            </div>
          </div>

          <div className="dialog__field">
            <span className="dialog__label">版本与更新</span>
            <div className="dialog__row">
              <span className="dialog__value tabular">
                {update.state ? `当前 ${update.state.currentVersion}` : '（读取中）'}
                {update.state?.version ? ` → ${update.state.version}` : ''}
              </span>
              {update.state?.phase === 'available' ? (
                <button type="button" className="btn-outline" onClick={() => void update.download()}>
                  下载更新
                </button>
              ) : null}
              {update.state?.phase === 'downloaded' ? (
                <button
                  type="button"
                  className="btn-outline"
                  disabled={busy}
                  title={busy ? '有构建任务在跑，重启会把它掐掉' : undefined}
                  onClick={() => void update.install()}
                >
                  重启并安装
                </button>
              ) : null}
              <button
                type="button"
                className="btn-ghost"
                disabled={update.state?.phase === 'checking' || update.state?.phase === 'downloading'}
                onClick={() => void update.check()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                检查更新
              </button>
            </div>
            {update.state?.phase === 'downloading' ? (
              <span className="dialog__hint">正在下载 {update.state.percent}%</span>
            ) : update.state?.message ? (
              <span className="dialog__hint">{update.state.message}</span>
            ) : (
              <span className="dialog__hint">从 GitHub Releases 取新版本；便携版没有自动更新。</span>
            )}
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
      </div>
    </div>
  )
}
