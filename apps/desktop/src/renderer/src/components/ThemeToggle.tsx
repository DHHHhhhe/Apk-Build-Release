import { useRef } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemeChoice } from '@shared/types/settings'
import { useTheme } from '../hooks/useTheme'

const OPTIONS: Array<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: '跟随系统', Icon: Monitor },
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon }
]

/**
 * 主题档位切换。
 *
 * 三个档位并排，而不是一个开关 ——「跟随系统」是第三种状态，开关表达不了，
 * 也没法从开关的外观看出现在落在哪一档。
 *
 * 三个按钮都是纯图标，所以按 radiogroup 的规矩来：方向键换档、只有当前档进 Tab 序列
 * （roving tabindex），否则键盘用户得按三次 Tab 才能越过它。
 */
export function ThemeToggle(): React.JSX.Element {
  const { theme, busy, setTheme } = useTheme()
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  const move = (delta: number): void => {
    const current = OPTIONS.findIndex((option) => option.value === theme)
    const index = (current + delta + OPTIONS.length) % OPTIONS.length
    const next = OPTIONS[index]
    if (!next) {
      return
    }
    void setTheme(next.value)
    buttons.current[index]?.focus()
  }

  return (
    <div
      className="theme-toggle"
      role="radiogroup"
      aria-label="主题"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        }
      }}
    >
      {OPTIONS.map((option, index) => {
        const active = option.value === theme
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            tabIndex={active ? 0 : -1}
            disabled={busy}
            className={active ? 'theme-toggle__option theme-toggle__option--active' : 'theme-toggle__option'}
            onClick={() => {
              void setTheme(option.value)
            }}
          >
            <option.Icon size={14} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
