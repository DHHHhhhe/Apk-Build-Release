import { FolderPlus, Trash2 } from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'

export function ProjectList({
  projects,
  selectedId,
  busyProjectId,
  queuedProjectIds,
  onSelect,
  onAdd,
  onRemove,
  onReorder
}: {
  projects: Project[]
  selectedId: string | null
  busyProjectId: string | null
  /** 队列里还没结束的项目：这些项目不允许移除（正在跑或即将跑） */
  queuedProjectIds: string[]
  onSelect: (projectId: string) => void
  onAdd: () => void
  onRemove: (projectId: string) => void
  /** 手工排序：给出完整的新顺序（当前全部项目 id） */
  onReorder: (projectIds: string[]) => void
}): React.JSX.Element {
  const queued = new Set(queuedProjectIds)

  /** 把某个项目往前/往后挪一位，然后整份顺序交出去 */
  const move = (projectId: string, delta: -1 | 1): void => {
    const ids = projects.map((project) => project.id)
    const at = ids.indexOf(projectId)
    const current = ids[at]
    const swapped = ids[at + delta]
    if (at < 0 || current === undefined || swapped === undefined) {
      return
    }
    ids[at] = swapped
    ids[at + delta] = current
    onReorder(ids)
  }

  /** 拖动落位：把被拖的项目插到目标项目的位置上 */
  const dropOn = (draggedId: string, targetId: string): void => {
    if (draggedId.length === 0 || draggedId === targetId) {
      return
    }
    const ids = projects.map((project) => project.id).filter((id) => id !== draggedId)
    const at = ids.indexOf(targetId)
    ids.splice(at < 0 ? ids.length : at, 0, draggedId)
    onReorder(ids)
  }

  return (
    <div className="project-list">
      <div className="project-list__head">
        <span className="project-list__title">项目</span>
        <Button  variant="ghost" className="project-list__add" onClick={onAdd}>
          <FolderPlus size={14} aria-hidden="true" />
          添加
        </Button>
      </div>

      {projects.length === 0 ? (
        <p className="project-list__empty">还没有项目，点右上角「添加」选择项目目录</p>
      ) : (
        <ul className="project-list__items">
          {projects.map((project, index) => {
            const active = project.id === selectedId
            const busy = project.id === busyProjectId
            const inQueue = queued.has(project.id)
            return (
              <li key={project.id}>
                <div
                  className={active ? 'project-list__item project-list__item--active' : 'project-list__item'}
                  draggable
                  onDragStart={(event) => {
                    // 拖拽只是快捷方式：同一行里的上移/下移按钮才是键盘与读屏用户走的那条路
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', project.id)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    dropOn(event.dataTransfer.getData('text/plain'), project.id)
                  }}
                >
                  <button
                    type="button"
                    className="project-list__select"
                    onClick={() => {
                      onSelect(project.id)
                    }}
                  >
                    <span className="project-list__name">{project.name}</span>
                    <span className="project-list__meta">
                      {/* 数与右侧实际能构建的变体对齐：这里以前数的是全部变体（含 debug），
                          于是侧栏写「2 个变体」、点进去只有一个可构建的 */}
                      <Badge variant="muted" className="tabular">
                        {filterVariantsForPackaging(project.variants).length} 个变体
                      </Badge>
                      {project.selectedVariants.length > 0 ? (
                        <Badge variant="success" className="tabular">
                          已选 {project.selectedVariants.length}
                        </Badge>
                      ) : null}
                      {inQueue ? <Badge variant="info">队列中</Badge> : null}
                    </span>
                  </button>

                  {/*
                   * 手工排序的两个按钮：拖拽对键盘与读屏用户等于不存在，
                   * 有一对能点的按钮才算两种输入方式都能用（WCAG 2.5.7）。
                   */}
                  <span className="project-list__order">
                    <Button
                      variant="ghost"
                      className="project-list__order-btn"
                      aria-label={`把 ${project.name} 上移`}
                      disabled={index === 0}
                      onClick={() => {
                        move(project.id, -1)
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      className="project-list__order-btn"
                      aria-label={`把 ${project.name} 下移`}
                      disabled={index === projects.length - 1}
                      onClick={() => {
                        move(project.id, 1)
                      }}
                    >
                      ↓
                    </Button>
                  </span>

                  <Button
                    variant="ghost"
                    className="project-list__remove"
                    title={inQueue ? '这个项目还在队列里，先取消它再移除' : `移除 ${project.name}`}
                    onClick={() => {
                      onRemove(project.id)
                    }}
                    disabled={busy || inQueue}
                    aria-label={`移除 ${project.name}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
