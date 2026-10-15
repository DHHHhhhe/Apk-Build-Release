import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * 对话框外壳。
 *
 * 三个对话框（更新记录、设置、确认）本来各自抄了一遍同样的骨架：Esc 关闭、点遮罩关闭、
 * 面板上挡住冒泡、role 与 aria-modal。这里收成一处，并补上它们都缺的两件事 ——
 * **焦点陷阱**（Tab 不会跑到背后的界面上）与**关闭后把焦点还回触发元素**。
 *
 * 只做外壳，不做视觉：面板内容仍由各对话框自己写，样式类沿用 .dialog*。
 */
export function Dialog({
  open,
  role = 'dialog',
  labelledBy,
  label,
  className,
  onClose,
  children
}: {
  open: boolean
  /** 需要用户确认的用 alertdialog，普通信息面板用 dialog */
  role?: 'dialog' | 'alertdialog'
  /** 标题元素的 id；给了就用 aria-labelledby，否则用 aria-label */
  labelledBy?: string
  label?: string
  className?: string
  onClose: () => void
  children: ReactNode
}): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Esc 关闭
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

  // 打开时记住触发元素、把焦点送进面板；关闭时还回去。Tab 在面板内循环。
  useEffect(() => {
    if (!open) {
      return
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = (): HTMLElement[] =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((element) => !element.hasAttribute('disabled'))
        : []

    const first = focusables()[0]
    if (first) {
      first.focus()
    } else {
      panel?.focus()
    }

    const handleTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') {
        return
      }
      const list = focusables()
      const head = list[0]
      const tail = list[list.length - 1]
      if (!head || !tail) {
        return
      }
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    window.addEventListener('keydown', handleTab)
    return () => {
      window.removeEventListener('keydown', handleTab)
      // 触发它的那个按钮可能已经不在了（比如项目被移除），那就别硬聚焦
      if (trigger?.isConnected) {
        trigger.focus()
      }
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={className ? `dialog ${className}` : 'dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : (label ?? '对话框')}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        {children}
      </div>
    </div>
  )
}