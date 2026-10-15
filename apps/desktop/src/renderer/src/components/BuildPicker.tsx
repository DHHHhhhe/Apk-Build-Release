import { useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ChevronDown, ChevronRight, TerminalSquare } from 'lucide-react'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project, ProjectVariant } from '@shared/types/project'
import { variantBadgeVisibility } from '../lib/variant-badges'

interface BuildPickerProps {
  projects: Project[]
  busyProjectId: string | null
  /** 已在队列中的项目 id：这些项目本次会被跳过，但仍允许为下一批改勾选 */
  queuedProjectIds: Set<string>
  /** 会被构建的变体总数，就是按钮上的 N */
  buildableVariantCount: number
  blockedReason: string | null
  queuedHint: string | null
  onSetVariants: (projectId: string, names: string[]) => void
  onRefreshVariants: (projectId: string) => void
  onBuild: () => void
}

/**
 * 当前参与出包的变体：与主进程入队共用同一条规则（只出 release；项目没有 release 时回退全部）。
 * 界面不再提供绕开这条规则的入口。
 */
function visibleVariantsOf(project: Project): ProjectVariant[] {
  return filterVariantsForPackaging(project.variants)
}

/**
 * 跨项目的勾选表：在一处看见并修改「这次要打哪些包」，然后一次入队。
 *
 * 快捷操作的作用范围只限于可见变体：看不见的勾选不会被「全选 / 清空 / 只选某类型」悄悄丢掉。
 */
export function BuildPicker({
  projects,
  busyProjectId,
  queuedProjectIds,
  buildableVariantCount,
  blockedReason,
  queuedHint,
  onSetVariants,
  onRefreshVariants,
  onBuild
}: BuildPickerProps): React.JSX.Element {
  // 默认全展开；折叠状态只存在界面里，不影响勾选
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleCollapsed = (projectId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  const selectedCount = projects.reduce(
    (total, project) => total + project.selectedVariants.length,
    0
  )
  const visibleCount = projects.reduce(
    (total, project) => total + visibleVariantsOf(project).length,
    0
  )

  /** 只加不减：全选不会把看不见的勾选抹掉 */
  const selectAllOf = (project: Project): void => {
    const merged = new Set(project.selectedVariants)
    for (const variant of visibleVariantsOf(project)) {
      merged.add(variant.name)
    }
    onSetVariants(project.id, Array.from(merged))
  }

  const selectAll = (): void => {
    for (const project of projects) {
      selectAllOf(project)
    }
  }

  const clearAll = (): void => {
    for (const project of projects) {
      onSetVariants(project.id, [])
    }
  }

  const onlyBuildTypeOf = (project: Project, buildType: string): void => {
    // 保留隐藏的勾选，只重排可见的那部分
    const hidden = project.selectedVariants.filter(
      (name) => !visibleVariantsOf(project).some((variant) => variant.name === name)
    )
    const picked = visibleVariantsOf(project)
      .filter((variant) => variant.buildType === buildType)
      .map((variant) => variant.name)
    onSetVariants(project.id, [...hidden, ...picked])
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
      return
    }
    if (event.key === 'Escape') {
      // 焦点在勾选表里时，Esc 归勾选表（清空）；stopPropagation 挡住抽屉的同名快捷键，
      // 否则一次 Esc 会既清空勾选又关掉抽屉
      event.stopPropagation()
      clearAll()
    }
  }

  if (projects.length === 0) {
    return <p className="build-picker__empty">还没有项目。先在上面添加一个 Android 项目。</p>
  }

  return (
    <div className="build-picker" onKeyDown={handleKeyDown}>
      <div className="build-picker__bar">
        <span className="build-picker__count tabular" role="status" aria-live="polite">
          已选 {selectedCount} / 可构建 {buildableVariantCount}
        </span>
        <Button
          variant="ghost"
          disabled={visibleCount === 0}
          onClick={selectAll}
        >
          全选全部项目（{visibleCount} 个变体）
        </Button>
        <Button  variant="ghost" disabled={selectedCount === 0} onClick={clearAll}>
          清空
        </Button>
      </div>

      <ul className="build-picker__groups">
        {projects.map((project) => {
          const visible = visibleVariantsOf(project)
          const selected = new Set(project.selectedVariants)
          const isCollapsed = collapsed.has(project.id)
          const queued = queuedProjectIds.has(project.id)
          const buildTypes = Array.from(new Set(visible.map((variant) => variant.buildType)))
          const badgeVisibility = variantBadgeVisibility(visible)

          return (
            <li key={project.id} className="summary__group build-picker__group">
              <div className="summary__group-head build-picker__group-head">
                <Button
                  variant="ghost"
                  className="build-picker__collapse"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? `展开 ${project.name}` : `收起 ${project.name}`}
                  onClick={() => {
                    toggleCollapsed(project.id)
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                </Button>
                <span className="summary__group-name">{project.name}</span>
                <span className="summary__group-path tabular" title={project.path}>
                  {project.path}
                </span>
                {queued ? <Badge variant="info">队列中</Badge> : null}
                {project.variants.length === 0 ? (
                  <Badge variant="muted">无变体</Badge>
                ) : null}
                <span className="build-picker__group-actions">
                  <Button
                    variant="ghost"
                    disabled={busyProjectId !== null || visible.length === 0}
                    onClick={() => {
                      selectAllOf(project)
                    }}
                  >
                    全选本项目（{visible.length} 个变体）
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busyProjectId !== null || project.selectedVariants.length === 0}
                    onClick={() => {
                      onSetVariants(project.id, [])
                    }}
                  >
                    清空
                  </Button>
                  {/* 只有一种 buildType 时这个按钮是恒等操作（「只选 release」= 全选），不显示 */}
                  {buildTypes.length > 1
                    ? buildTypes.map((buildType) => (
                        <Button
                          key={buildType}
                          variant="ghost"
                          disabled={busyProjectId !== null}
                          onClick={() => {
                            onlyBuildTypeOf(project, buildType)
                          }}
                        >
                          只选 {buildType}
                        </Button>
                      ))
                    : null}
                </span>
              </div>

              {isCollapsed ? null : project.variants.length === 0 ? (
                <p className="build-picker__hint">
                  没解析出变体。点右侧「用 Gradle 解析」跑一遍真实配置，或者先在项目详情里刷新变体。
                  <Button
                    variant="ghost"
                    className="build-picker__inline-action"
                    disabled={busyProjectId !== null}
                    onClick={() => {
                      onRefreshVariants(project.id)
                    }}
                  >
                    <TerminalSquare size={14} aria-hidden="true" />
                    {busyProjectId === project.id ? 'Gradle 解析中…' : '用 Gradle 解析（较慢）'}
                  </Button>
                </p>
              ) : (
                <ul className="build-picker__rows">
                  {visible.map((variant) => (
                    <li key={variant.name} className="build-picker__row">
                      <label className="build-picker__label">
                        <input
                          type="checkbox"
                          checked={selected.has(variant.name)}
                          disabled={busyProjectId !== null}
                          onChange={() => {
                            const next = new Set(project.selectedVariants)
                            if (next.has(variant.name)) {
                              next.delete(variant.name)
                            } else {
                              next.add(variant.name)
                            }
                            onSetVariants(project.id, Array.from(next))
                          }}
                        />
                        <span className="build-picker__variant tabular">{variant.name}</span>
                      </label>
                      {badgeVisibility.flavor && variant.flavor ? (
                        <Badge variant="muted">{variant.flavor}</Badge>
                      ) : null}
                      {badgeVisibility.buildType ? (
                        <Badge variant="muted">{variant.buildType}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      <div className="build-picker__foot">
        <Button  variant="outline" disabled={blockedReason !== null} onClick={onBuild}>
          构建勾选项（{buildableVariantCount}）
        </Button>
        {blockedReason ? (
          <span className="build-picker__reason" role="status" aria-live="polite">
            {blockedReason}
          </span>
        ) : null}
        {queuedHint ? <span className="build-picker__reason">{queuedHint}</span> : null}
      </div>
    </div>
  )
}
