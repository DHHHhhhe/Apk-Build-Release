import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Project } from '@shared/types/project'

/** 抽屉宽度可拖动调整；范围夹住，免得拖成一条缝或者盖满整屏 */
const DRAWER_WIDTH_KEY = 'abr.drawerWidth'
const DRAWER_WIDTH_DEFAULT = 560
const DRAWER_WIDTH_MIN = 380
const DRAWER_WIDTH_MAX = 900

function clampDrawerWidth(value: number): number {
  return Math.min(Math.max(Math.round(value), DRAWER_WIDTH_MIN), DRAWER_WIDTH_MAX)
}

function readStoredDrawerWidth(): number {
  const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY)
  const parsed = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) ? clampDrawerWidth(parsed) : DRAWER_WIDTH_DEFAULT
}

interface ProjectDrawerProps {
  project: Project
  onClose: () => void
  children: React.ReactNode
}

/**
 * 项目抽屉：非模态的右侧检查面板。
 *
 * 非模态是有意的 —— 抽屉的用途是查看与对照，不是必须处理完才能继续的事务。
 * 所以不阻断背景、不加 inert、不做焦点陷阱：抽屉开着的时候，主列的勾选照样能改。
 * 但非模态浮层该有的那几条一样要有：Esc 可关、打开时焦点进来、关闭后焦点回到打开它的那个项目。
 *
 * 关闭链路只有一条（onClose），关闭按钮与 Esc 都走它，不会出现两套收尾逻辑。
 */
export function ProjectDrawer({
  project,
  onClose,
  children
}: ProjectDrawerProps): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [width, setWidth] = useState(readStoredDrawerWidth)
  const resizingRef = useRef(false)

  /*
   * 宽度写成 CSS 变量：抽屉自己的宽度与主内容「避让抽屉」的右边距用的是同一个变量，
   * 改一处两处都跟着走，不会出现抽屉变宽了而内容还被压着。
   */
  useEffect(() => {
    /*
     * 写到抽屉的**父元素**上，不是 :root。
     *
     * App 会把响应式默认宽度声明在那一层（`--drawer-width: resolveDrawerWidth(windowWidth)`），
     * 而自定义属性是继承的：写在 :root 上的值会被父元素自己的声明压掉 —— 实测过，
     * :root 读到 624px 而抽屉仍是 560px。写在同一个元素上才盖得住。
     */
    const host = document.querySelector('.drawer')?.parentElement ?? document.documentElement
    host.style.setProperty('--drawer-width', `${width}px`)
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(width))
  }, [width])

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    resizingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizingRef.current) {
      return
    }
    // 抽屉贴着窗口右边，所以宽度就是「指针到窗口右边的距离」
    setWidth(clampDrawerWidth(window.innerWidth - event.clientX))
  }

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
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
    setWidth((current) => clampDrawerWidth(current + (event.key === 'ArrowLeft' ? 16 : -16)))
  }

  // 打开时记住焦点从哪来，关闭时还回去；触发项已经不在了（例如项目被移除）就不还，
  // 硬聚焦一个已经离场的节点会让焦点掉到 body 上，反而更难用
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
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

  return (
    <aside className="drawer" aria-labelledby="project-drawer-title">
      <div
        className="drawer__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        aria-valuenow={width}
        aria-valuemin={DRAWER_WIDTH_MIN}
        aria-valuemax={DRAWER_WIDTH_MAX}
        tabIndex={0}
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => {
          setWidth(DRAWER_WIDTH_DEFAULT)
        }}
        onKeyDown={resizeWithKeyboard}
      />
      <header className="drawer__head">
        <h2 className="drawer__title" id="project-drawer-title">
          {project.name}
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="btn-ghost drawer__close"
          aria-label="关闭项目面板"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <span className="drawer__path tabular" title={project.path}>
          {project.path}
        </span>
      </header>
      <div className="drawer__body">{children}</div>
    </aside>
  )
}
