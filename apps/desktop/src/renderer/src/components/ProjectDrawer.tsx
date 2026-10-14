import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { Project } from '@shared/types/project'

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
