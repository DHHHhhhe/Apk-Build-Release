import { useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { X } from 'lucide-react'
import type { Project } from '@shared/types/project'
import { clampDrawerWidth } from '../hooks/useDrawerWidth'
import { lastInputWasKeyboard } from '../lib/input-mode'
import { DRAWER_DRAG_MAX, DRAWER_DRAG_MIN, preferredDrawerWidth } from '../lib/layout'

/** 抽屉里可以被「跳到某一段」定位的三块 */
export type DrawerSection = 'variants' | 'env' | 'log'

export interface DrawerFocus {
  section: DrawerSection
  /** 每次请求都换一个值：同一个目标连点两次也要重新滚一次 */
  token: number
}

interface ProjectDrawerProps {
  project: Project
  /** 实际宽度（已按窗口与侧栏约束算过），由 App 给出 */
  width: number
  /** 拖动中：立即生效，不落盘 */
  onResize: (width: number) => void
  /** 松手/键盘调整结束：落盘 */
  onResizeCommit: (width: number) => void
  focusSection: DrawerFocus | null
  onClose: () => void
  children: React.ReactNode
}

/**
 * 项目抽屉：非模态的右侧检查面板。
 *
 * 非模态是有意的 —— 抽屉的用途是查看与对照，不是必须处理完才能继续的事务。
 * 所以不阻断背景、不加 inert、不做焦点陷阱：抽屉开着的时候，主列的勾选照样能改。
 * 但非模态浮层该有的那几条一样要有：Esc 可关、键盘打开时焦点进来、关闭后焦点回到打开它的那个项目。
 *
 * 宽度是**受控**的：App 按「窗口 − 侧栏 − 主列地板」算完再传进来。
 * 以前宽度存在这里，于是避让按布局常量算、抽屉按用户拖的值画，两个数不一致时避让也白搭。
 */
export function ProjectDrawer({
  project,
  width,
  onResize,
  onResizeCommit,
  focusSection,
  onClose,
  children
}: ProjectDrawerProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const resizingRef = useRef(false)

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    resizingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizingRef.current) {
      return
    }
    // 抽屉贴着窗口右边，所以宽度就是「指针到窗口右边的距离」
    onResize(clampDrawerWidth(window.innerWidth - event.clientX))
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (resizingRef.current) {
      onResizeCommit(width)
    }
    resizingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    // 键盘也要能调：拖拽不能是唯一手段（WCAG 2.5.7）
    const next = clampDrawerWidth(width + (event.key === 'ArrowLeft' ? 16 : -16))
    onResize(next)
    onResizeCommit(next)
  }

  /*
   * 打开时记住焦点从哪来，关闭时还回去；触发项已经不在了（例如项目被移除）就不还，
   * 硬聚焦一个已经离场的节点会让焦点掉到 body 上，反而更难用。
   *
   * 是否把焦点搬进抽屉按**最后用的输入方式**决定：鼠标点开时抢焦点会打断
   * 「接着点下一个项目」的连续操作；键盘打开时必须搬，否则按 Tab 会从抽屉背后继续走。
   */
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (lastInputWasKeyboard()) {
      closeRef.current?.focus()
    }
    return () => {
      if (trigger?.isConnected) {
        trigger.focus()
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  /*
   * 「查看日志」这类入口的目的就是看那一段，打开抽屉后要把它滚进视野并闪一下。
   *
   * 目标区是**异步**渲染出来的：跨项目点「查看日志」时，抽屉先换成那个项目的骨架，
   * 构建记录要等 listRuns 回来才出现。一次 querySelector 很可能扑空（实测就是这样：
   * 高亮加上了、滚动没发生）。所以按帧重试几次，拿到就滚。
   *
   * 不用 smooth：切项目时抽屉内容整块换掉，平滑滚动会被这次变化打断，反而停在原地。
   */
  const focusToken = focusSection?.token ?? null
  const focusTarget = focusSection?.section ?? null
  useEffect(() => {
    if (focusTarget === null) {
      return
    }
    let cancelled = false
    let attempts = 0
    let timer = 0
    let flashed: HTMLElement | null = null

    const tryScroll = (): void => {
      if (cancelled) {
        return
      }
      const body = bodyRef.current
      const node = body?.querySelector(`[data-drawer-section="${focusTarget}"]`)
      if (body && node instanceof HTMLElement) {
        const bodyRect = body.getBoundingClientRect()
        const nodeRect = node.getBoundingClientRect()
        // 先按「这一段顶部对齐面板顶部」滚
        body.scrollTop += nodeRect.top - bodyRect.top - 8
        /*
         * 日志是抽屉里的最后一块，它下面没有更多内容 —— 顶部对齐需要的滚动量会超过
         * 最大可滚距离，被夹住之后只露出一条边（实测：顶部停在 707，面板顶在 48）。
         * 这种情况改成让它的底部贴住面板底部，至少整段可见。
         */
        if (node.getBoundingClientRect().top > bodyRect.top + 8) {
          body.scrollTop = body.scrollHeight
        }
        node.classList.add('drawer-section--flash')
        flashed = node
        timer = window.setTimeout(() => {
          node.classList.remove('drawer-section--flash')
        }, 1400)
        return
      }
      attempts += 1
      if (attempts < 12) {
        timer = window.setTimeout(tryScroll, 120)
      }
    }
    tryScroll()

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      flashed?.classList.remove('drawer-section--flash')
    }
    // focusToken 变化即重新定位；focusTarget 与它同源，列出来只是为了让依赖完整
  }, [focusToken, focusTarget])

  return (
    <aside className="drawer" aria-labelledby="project-drawer-title" style={{ width: `${width}px` }}>
      <div
        className="drawer__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        aria-valuenow={width}
        aria-valuemin={DRAWER_DRAG_MIN}
        aria-valuemax={DRAWER_DRAG_MAX}
        tabIndex={0}
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => {
          onResizeCommit(preferredDrawerWidth(window.innerWidth))
        }}
        onKeyDown={resizeWithKeyboard}
      />
      <header className="drawer__head">
        <h2 className="drawer__title" id="project-drawer-title">
          {project.name}
        </h2>
        <Button
          ref={closeRef}
          variant="ghost"
          className="drawer__close"
          aria-label="关闭项目面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </Button>
        <span className="drawer__path tabular" title={project.path}>
          {project.path}
        </span>
      </header>
      <div className="drawer__body" ref={bodyRef}>
        {children}
      </div>
    </aside>
  )
}
