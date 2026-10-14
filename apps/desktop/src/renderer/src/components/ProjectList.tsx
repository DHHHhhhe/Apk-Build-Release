import { FolderPlus, Trash2 } from 'lucide-react'
import type { Project } from '@shared/types/project'

export function ProjectList({
  projects,
  selectedId,
  busyProjectId,
  queuedProjectIds,
  onSelect,
  onAdd,
  onRemove
}: {
  projects: Project[]
  selectedId: string | null
  busyProjectId: string | null
  /** 队列里还没结束的项目：这些项目不允许移除（正在跑或即将跑） */
  queuedProjectIds: string[]
  onSelect: (projectId: string) => void
  onAdd: () => void
  onRemove: (projectId: string) => void
}): React.JSX.Element {
  const queued = new Set(queuedProjectIds)

  return (
    <div className="project-list">
      <div className="project-list__head">
        <span className="project-list__title">项目</span>
        <button
          type="button"
          className="btn-ghost project-list__add"
          onClick={onAdd}
          disabled={busyProjectId === '__add__'}
          aria-label="添加本地项目"
        >
          <FolderPlus size={16} aria-hidden="true" />
          {busyProjectId === '__add__' ? '解析中' : '添加'}
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="project-list__empty">还没有项目，点右上角「添加」选择项目目录</p>
      ) : (
        <ul className="project-list__items">
          {projects.map((project) => {
            const active = project.id === selectedId
            const busy = project.id === busyProjectId
            const inQueue = queued.has(project.id)
            return (
              <li key={project.id}>
                <div className={active ? 'project-list__item project-list__item--active' : 'project-list__item'}>
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
                      <span className="badge badge--muted tabular">
                        {filterVariantsForPackaging(project.variants).length} 个变体
                      </span>
                      {project.selectedVariants.length > 0 ? (
                        <span className="badge badge--success tabular">
                          已选 {project.selectedVariants.length}
                        </span>
                      ) : null}
                      {inQueue ? <span className="badge badge--info">队列中</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost project-list__remove"
                    title={inQueue ? '这个项目还在队列里，先取消它再移除' : `移除 ${project.name}`}
                    onClick={() => {
                      onRemove(project.id)
                    }}
                    disabled={busy || inQueue}
                    aria-label={`移除 ${project.name}`}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
