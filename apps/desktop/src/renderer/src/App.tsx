import { useMemo, useState } from 'react'
import { Settings } from 'lucide-react'
import logoUrl from './assets/logo.png'
import { BuildPanel } from './components/BuildPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EnvCard } from './components/EnvCard'
import { GuideCard } from './components/GuideCard'
import { ProjectDetail } from './components/ProjectDetail'
import { ProjectDrawer } from './components/ProjectDrawer'
import { ProjectList } from './components/ProjectList'
import { QueuePanel } from './components/QueuePanel'
import { SettingsDialog } from './components/SettingsDialog'
import { BuildCenter } from './components/BuildCenter'
import { ThemeToggle } from './components/ThemeToggle'
import { buildBlockedReason, enqueueTargets, queuedExclusionHint } from './lib/build-guard'
import { resolveBuildableVariants } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'
import { useBuild } from './hooks/useBuild'
import { useDragAndDrop } from './hooks/useDragAndDrop'
import { useEnvProbe } from './hooks/useEnvProbe'
import { useProjects } from './hooks/useProjects'
import { useQueue } from './hooks/useQueue'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { useUpdate } from './hooks/useUpdate'
import { useWindowWidth } from './hooks/useWindowWidth'
import { resolveDrawerWidth, shouldAvoidDrawer } from './lib/layout'

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
    pendingWrites,
    addProject,
    removeProject,
    refreshVariants,
    setVariants
  } = useProjects()

  // 抽屉当前展示的项目。刻意不回退到「第一个项目」：没打开任何项目时，
  // 主列就该只有全局内容，不该凭空出现一个项目的详情
  const selectedProject = useMemo(() => {
    if (selectedProjectId === null) {
      return null
    }
    return projects.find((project) => project.id === selectedProjectId) ?? null
  }, [projects, selectedProjectId])

  const queue = useQueue()
  const build = useBuild(selectedProject?.id ?? null)
  const env = useEnvProbe(selectedProject?.path ?? '')
  const sidebar = useSidebarWidth()
  const windowWidth = useWindowWidth()
  const update = useUpdate()

  // 抽屉打开时：窗口够宽就让主列整列避让（右侧那排组内按钮不被盖住），
  // 不够宽就宁可让抽屉盖住 —— 被挤窄的主列没法用
  const avoidDrawer =
    selectedProject !== null && shouldAvoidDrawer({ windowWidth, sidebarWidth: sidebar.width })

  const selectedVariants = selectedProject?.selectedVariants ?? []
  // 与主进程同一条规则（shared/lib/variants）：列表里没显示的变体不参与构建
  const resolvedVariants = selectedProject
    ? resolveBuildableVariants({ variants: selectedProject.variants, selected: selectedVariants })
    : { buildable: [], unknownSelected: [] }
  const buildableVariants = resolvedVariants.buildable
  const currentItem = queue.items.find(
    (item) =>
      item.projectId === selectedProject?.id && (item.state === 'running' || item.state === 'pending')
  )
  const projectBuilding = currentItem?.state === 'running'
  // 环境缺失（比如 SDK 没找到）时不该让用户白等一次构建
  const envBlocking = env.result?.items.find((item) => item.state === 'error') ?? null
  const enqueueBlocked = blockedReason({
    drawerOpen: Boolean(selectedProject),
    hasProjects: projects.length > 0,
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

  // 跨项目的构建判断基准。注意单位：变体数用于按钮上的 N，项目数用于「都被队列占了」的判断，
  // 两者混着比会在某些巧合下得出看似正确的结果。
  const queuedProjectIds = new Set(
    queue.items
      .filter((item) => item.state === 'running' || item.state === 'pending')
      .map((item) => item.projectId)
  )
  const projectResolutions = new Map(
    projects.map((project) => [
      project.id,
      resolveBuildableVariants({
        variants: project.variants,
        selected: project.selectedVariants
      })
    ])
  )
  const crossProject = {
    buildableVariantCount: 0,
    pendingProjectCount: 0,
    queuedProjectCount: 0,
    unknownSelectedCount: 0
  }
  for (const project of projects) {
    const resolved = projectResolutions.get(project.id)
    if (!resolved) {
      continue
    }
    crossProject.buildableVariantCount += resolved.buildable.length
    crossProject.unknownSelectedCount += resolved.unknownSelected.length
    if (resolved.buildable.length > 0) {
      if (queuedProjectIds.has(project.id)) {
        crossProject.queuedProjectCount += 1
      } else {
        crossProject.pendingProjectCount += 1
      }
    }
  }
  // 顶栏按钮与表内按钮共用同一份判断：同一个动作的两个位置，禁用条件必须字字相同
  const buildGuard = { pendingWrites, ...crossProject }
  const crossBlocked = buildBlockedReason(buildGuard)
  const crossHint = queuedExclusionHint(buildGuard)

  /** 入队勾选的项目：排除已在队列里的，并把要打的变体一并带上 */
  const buildCheckedProjects = (): void => {
    const targets = enqueueTargets(projects, projectResolutions, queuedProjectIds)
    if (targets.length > 0) {
      void queue.enqueue(targets)
    }
  }

  return (
    <div
      className="app-shell"
      style={
        {
          '--sidebar-width': `${sidebar.width}px`,
          '--drawer-width': `${resolveDrawerWidth(windowWidth)}px`
        } as React.CSSProperties
      }
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
            ? ` · 当前项目已选 ${buildableVariants.length} 个变体`
            : ''}
        </span>
        {enqueueBlocked ? <span className="app-topbar__hint">{enqueueBlocked}</span> : null}
        <button
          type="button"
          className="btn-outline"
          disabled={crossBlocked !== null}
          title={crossBlocked ?? '把勾选的变体加入队列并构建'}
          onClick={buildCheckedProjects}
        >
          构建勾选项（{crossProject.buildableVariantCount}）
        </button>
        {update.state?.phase === 'available' || update.state?.phase === 'downloaded' ? (
          <button
            type="button"
            className="btn-outline"
            title={update.state.message}
            onClick={() => {
              setSettingsOpen(true)
            }}
          >
            有新版本
          </button>
        ) : null}
        <button
          type="button"
          className="btn-outline"
          disabled={Boolean(enqueueBlocked) || !selectedProject}
          title={enqueueBlocked ?? undefined}
          onClick={() => {
            if (selectedProject) {
              // 带上抽屉里这个项目当前可构建的变体，主进程不再回读数据库
              void queue.enqueue([{ projectId: selectedProject.id, variants: buildableVariants }])
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
            queuedProjectIds={Array.from(queuedProjectIds)}
            onSelect={setSelectedProjectId}
            onAdd={handleAdd}
            onRemove={setPendingRemove}
          />
          {/* 左下角：主题档位与设置入口（自动更新的入口同样在这条上） */}
          <div className="app-sidebar__bottom">
            <ThemeToggle />
            <button
              type="button"
              className="app-sidebar__action"
              aria-label="设置"
              title="设置"
              onClick={() => {
                setSettingsOpen(true)
              }}
            >
              <Settings size={14} aria-hidden="true" />
              设置
            </button>
          </div>
        </aside>

        <main className={avoidDrawer ? 'app-content app-content--avoid-drawer' : 'app-content'}>
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
              {/* 主列只放全局内容：构建中心是主操作区，队列跟着它；随选中项目变化的东西全进右侧抽屉 */}
              <BuildCenter
                projects={projects}
                busyProjectId={busyProjectId}
                queuedProjectIds={queuedProjectIds}
                buildableVariantCount={crossProject.buildableVariantCount}
                blockedReason={crossBlocked}
                queuedHint={crossHint}
                onSetVariants={(projectId, names) => {
                  void setVariants(projectId, names)
                }}
                onRefreshVariants={(projectId) => {
                  void refreshVariants(projectId, true)
                }}
                onBuild={buildCheckedProjects}
              />

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
            </>
          )}
        </main>

        {/* 项目级内容全部收在这里。非模态：抽屉开着的时候主列的勾选照旧能改 */}
        {selectedProject ? (
          <ProjectDrawer
            project={selectedProject}
            onClose={() => {
              setSelectedProjectId(null)
            }}
          >
            <ProjectDetail
              project={selectedProject}
              busyKind={busyProjectId === selectedProject.id ? busyKind : null}
              building={projectBuilding}
              queuedVariants={currentItem?.variants ?? null}
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
            <BuildPanel
              runs={build.runs}
              logs={build.logs}
              activeRunId={build.activeRunId}
              building={projectBuilding}
              hasMore={build.hasMore}
              onLoadMore={build.loadMore}
            />
          </ProjectDrawer>
        ) : null}
      </div>

      <SettingsDialog
        open={settingsOpen}
        busy={queue.items.some((item) => item.state === 'running' || item.state === 'pending')}
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

/** 单项目按钮禁用时要说清原因，而不是让用户猜 */
function blockedReason(input: {
  /** 抽屉开着 = 有一个「当前项目」 */
  drawerOpen: boolean
  hasProjects: boolean
  variantCount: number
  busy: boolean
  alreadyQueued: boolean
  envIssue: string | null
}): string | null {
  if (input.busy) {
    return '正在处理上一个操作…'
  }
  if (!input.drawerOpen) {
    // 有项目但没打开：这个按钮指的是「抽屉里那个项目」，没打开就没有对象
    return input.hasProjects ? '先在左侧选一个项目' : '先添加一个项目'
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
