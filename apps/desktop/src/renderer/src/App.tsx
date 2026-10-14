import { useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import logoUrl from './assets/logo.png'
import { BuildPanel } from './components/BuildPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EnvCard } from './components/EnvCard'
import { GuideCard } from './components/GuideCard'
import { ProjectDetail } from './components/ProjectDetail'
import { ProjectList } from './components/ProjectList'
import { QueuePanel } from './components/QueuePanel'
import { SettingsDialog } from './components/SettingsDialog'
import { SummaryPanel } from './components/SummaryPanel'
import { useShowDebugVariants } from './hooks/useShowDebugVariants'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'
import { useBuild } from './hooks/useBuild'
import { useDragAndDrop } from './hooks/useDragAndDrop'
import { useEnvProbe } from './hooks/useEnvProbe'
import { useProjects } from './hooks/useProjects'
import { useQueue } from './hooks/useQueue'
import { useSidebarWidth } from './hooks/useSidebarWidth'

export default function App(): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const {
    projects,
    loading,
    error,
    busyProjectId,
    busyKind,
    addProject,
    removeProject,
    refreshVariants,
    setVariants
  } = useProjects()

  const selectedProject = useMemo(() => {
    if (projects.length === 0) {
      return null
    }
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null
  }, [projects, selectedProjectId])

  const queue = useQueue()
  const build = useBuild(selectedProject?.id ?? null)
  const env = useEnvProbe(selectedProject?.path ?? '')
  const sidebar = useSidebarWidth()
  const debug = useShowDebugVariants()

  const selectedVariants = selectedProject?.selectedVariants ?? []
  // 与主进程同一条规则：列表里没显示的变体不参与构建
  const buildableVariants = selectedProject ? buildableNamesOf(selectedProject, debug.showDebug) : []
  const hiddenSelectedCount = selectedVariants.length - buildableVariants.length
  const currentItem = queue.items.find(
    (item) =>
      item.projectId === selectedProject?.id && (item.state === 'running' || item.state === 'pending')
  )
  const projectBuilding = currentItem?.state === 'running'
  // 环境缺失（比如 SDK 没找到）时不该让用户白等一次构建
  const envBlocking = env.result?.items.find((item) => item.state === 'error') ?? null
  const enqueueBlocked = blockedReason({
    hasProject: Boolean(selectedProject),
    variantCount: buildableVariants.length,
    busy: busyProjectId !== null,
    alreadyQueued: Boolean(currentItem),
    envIssue: envBlocking ? `${envBlocking.label}${envBlocking.detail ? `：${envBlocking.detail}` : ' 不可用'}` : null
  })

  const runAdd = async (path: string): Promise<void> => {
    setAddError(null)
    const failure = await addProject(path)
    if (failure) {
      setAddError(failure)
    }
  }

  const drag = useDragAndDrop((path) => {
    void runAdd(path)
  })

  const handleAdd = (): void => {
    void window.api.project.pickDirectory().then(async (picked) => {
      if (!picked.success || !picked.path) {
        return
      }
      await runAdd(picked.path)
    })
  }

  const handleToggleVariant = (variantName: string): void => {
    if (!selectedProject) {
      return
    }
    const current = new Set(selectedProject.selectedVariants)
    if (current.has(variantName)) {
      current.delete(variantName)
    } else {
      current.add(variantName)
    }
    void setVariants(selectedProject.id, Array.from(current))
  }

  const removableProject = projects.find((project) => project.id === pendingRemove) ?? null
  const removableRecordCount = queue.items.filter((item) => item.projectId === pendingRemove).length
  const projectsReadyToQueue = projects.filter(
    (project) =>
      buildableNamesOf(project, debug.showDebug).length > 0 &&
      !queue.items.some(
        (item) =>
          item.projectId === project.id && (item.state === 'running' || item.state === 'pending')
      )
  )

  return (
    <div
      className="app-shell"
      style={{ '--sidebar-width': `${sidebar.width}px` } as React.CSSProperties}
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
    >
      <header className="app-topbar">
        <img className="app-topbar__logo" src={logoUrl} alt="" width={20} height={20} />
        <span className="app-topbar__title">APK批量打包</span>
        <span className="app-topbar__status">
          {loading ? '读取项目…' : `${projects.length} 个项目`}
          {selectedProject && buildableVariants.length > 0
            ? ` · 已选 ${buildableVariants.length} 个变体`
            : ''}
          {hiddenSelectedCount > 0 ? ` · ${hiddenSelectedCount} 个 debug 变体不参与出包` : ''}
        </span>
        {enqueueBlocked ? <span className="app-topbar__hint">{enqueueBlocked}</span> : null}
        <button
          type="button"
          className="btn-ghost"
          disabled={projectsReadyToQueue.length === 0}
          title="把已勾选变体的项目全部加入队列"
          onClick={() => {
            void queue.enqueue(projectsReadyToQueue.map((project) => project.id))
          }}
        >
          全部入队（{projectsReadyToQueue.length}）
        </button>
        <button
          type="button"
          className="btn-ghost"
          aria-label="设置"
          onClick={() => {
            setSettingsOpen(true)
          }}
        >
          <Settings size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={Boolean(enqueueBlocked) || !selectedProject}
          title={enqueueBlocked ?? undefined}
          onClick={() => {
            if (selectedProject) {
              void queue.enqueue([selectedProject.id])
            }
          }}
        >
          {projectBuilding ? '构建中…' : '加入队列并构建'}
        </button>
      </header>

      <div className="app-body">
        <aside className="app-sidebar" aria-label="项目列表">
          <div
            className="app-sidebar__resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            onPointerDown={sidebar.onResizeStart}
          />
          <ProjectList
            projects={projects}
            selectedId={selectedProject?.id ?? null}
            busyProjectId={busyProjectId}
            queuedProjectIds={queue.items
              .filter((item) => item.state === 'running' || item.state === 'pending')
              .map((item) => item.projectId)}
            onSelect={setSelectedProjectId}
            onAdd={handleAdd}
            onRemove={setPendingRemove}
          />
        </aside>

        <main className="app-content">
          {error ? (
            <p className="app-error" role="status" aria-live="polite">
              {error}
            </p>
          ) : null}
          {addError ? (
            <p className="app-error" role="status" aria-live="polite">
              {addError}
            </p>
          ) : null}
          {queue.error ? (
            <p className="app-error" role="status" aria-live="polite">
              {queue.error}
            </p>
          ) : null}
          {build.error ? (
            <p className="app-error" role="status" aria-live="polite">
              {build.error}
            </p>
          ) : null}

          {projects.length === 0 ? (
            <GuideCard onAdd={handleAdd} dragging={drag.dragging} />
          ) : (
            <>
              {selectedProject ? (
                <>
                  <ProjectDetail
                    project={selectedProject}
                    busyKind={busyProjectId === selectedProject.id ? busyKind : null}
                    building={projectBuilding}
                    queuedVariants={currentItem?.variants ?? null}
                    showDebug={debug.showDebug}
                    onToggleShowDebug={debug.toggle}
                    onToggleVariant={handleToggleVariant}
                    onSetVariants={(names) => {
                      void setVariants(selectedProject.id, names)
                    }}
                    onRefreshVariants={(force) => {
                      void refreshVariants(selectedProject.id, force)
                    }}
                  />
                  <EnvCard
                    result={env.result}
                    loading={env.loading}
                    error={env.error}
                    projectPath={selectedProject.path}
                    onRefresh={env.refresh}
                  />
                </>
              ) : null}

              <QueuePanel
                items={queue.items}
                concurrency={queue.concurrency}
                onCancel={(itemId) => {
                  void queue.cancel(itemId)
                }}
                onCancelAll={() => {
                  void queue.cancelAll()
                }}
                onRetry={(itemId) => {
                  void queue.retry(itemId)
                }}
                onClear={(scope) => {
                  void queue.clear(scope)
                }}
                onConcurrencyChange={(limit) => {
                  void queue.setConcurrency(limit)
                }}
                onShowLog={(projectId) => {
                  setSelectedProjectId(projectId)
                }}
              />

              <SummaryPanel />

              {selectedProject ? (
                <BuildPanel
                  runs={build.runs}
                  logs={build.logs}
                  activeRunId={build.activeRunId}
                  building={projectBuilding}
                  hasMore={build.hasMore}
                  onLoadMore={build.loadMore}
                />
              ) : null}
            </>
          )}
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
        }}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        title="移除这个项目？"
        tone="destructive"
        confirmLabel="移除"
        message={`将移除「${removableProject?.name ?? ''}」，同时删除它的 ${removableRecordCount} 条队列与构建记录（已经复制到输出目录的 APK 不会被删）。`}
        onCancel={() => {
          setPendingRemove(null)
        }}
        onConfirm={() => {
          if (pendingRemove) {
            void removeProject(pendingRemove)
          }
          setPendingRemove(null)
        }}
      />
    </div>
  )
}

/** 这个项目实际会参与构建的变体：勾选的 ∩ 列表里显示的 */
function buildableNamesOf(project: Project, showDebug: boolean): string[] {
  const visible = (showDebug ? project.variants : filterVariantsForPackaging(project.variants)).map(
    (variant) => variant.name
  )
  return project.selectedVariants.filter((name) => visible.includes(name))
}

/** 主按钮禁用时要说清原因，而不是让用户猜 */
function blockedReason(input: {
  hasProject: boolean
  variantCount: number
  busy: boolean
  alreadyQueued: boolean
  envIssue: string | null
}): string | null {
  if (input.busy) {
    return '正在处理上一个操作…'
  }
  if (!input.hasProject) {
    return '先添加一个项目'
  }
  if (input.envIssue) {
    return `构建环境有问题：${input.envIssue}`
  }
  if (input.variantCount === 0) {
    return '先在发布变体里勾选至少一个'
  }
  if (input.alreadyQueued) {
    return '这个项目已经在队列里了'
  }
  return null
}
