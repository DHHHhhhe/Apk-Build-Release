import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * 按钮。
 *
 * API 照参考实现（`variant` / `size`），实现走本项目已有的语义类 ——
 * 不引 Tailwind、不引 cva：这个仓库的样式全在 `styles/components/*.css`，
 * 再引一套原子类进来会变成两个真相（DESIGN.md 第 4 节）。
 *
 * 对应关系：
 *   default → btn-primary ｜ outline → btn-outline ｜ ghost → btn-ghost ｜ destructive → btn-destructive
 * 参考实现还有 secondary / link，本项目没有对应样式，用到时再补。
 */
export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive'
export type ButtonSize = 'default' | 'sm' | 'icon'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'btn-primary',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  destructive: 'btn-destructive'
}

const SIZE_CLASS: Record<ButtonSize, string | null> = {
  default: null,
  sm: 'btn--sm',
  icon: 'btn--icon'
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}): React.JSX.Element {
  const classes = [VARIANT_CLASS[variant], SIZE_CLASS[size], className].filter(Boolean).join(' ')
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}