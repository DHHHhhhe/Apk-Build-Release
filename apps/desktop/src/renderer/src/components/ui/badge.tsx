import type { HTMLAttributes, ReactNode } from 'react'

/**
 * 徽章。
 *
 * 与按钮同一套思路：API 照参考实现，类名走本项目已有语义类。
 *   default（不传）→ badge ｜ success / warning / destructive / info / muted → badge--xxx
 * 参考实现另有 secondary / outline / ghost / link，本项目没有对应样式。
 */
export type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted'

const VARIANT_CLASS: Record<BadgeVariant, string | null> = {
  default: null,
  success: 'badge--success',
  warning: 'badge--warning',
  destructive: 'badge--destructive',
  info: 'badge--info',
  muted: 'badge--muted'
}

export function Badge({
  variant = 'default',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant
  children?: ReactNode
}): React.JSX.Element {
  const classes = ['badge', VARIANT_CLASS[variant], className].filter(Boolean).join(' ')
  // 原生属性（title / aria-* 等）原样透传：迁移过来的调用点有带 title 的
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  )
}