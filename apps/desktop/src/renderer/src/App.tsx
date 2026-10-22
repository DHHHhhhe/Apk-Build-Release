import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from './components/ui/button'
import { FolderPlus, Settings } from 'lucide-react'
import { BuildPanel } from './components/BuildPanel'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EnvCard } from './components/EnvCard'
import { GuideCard } from './components/GuideCard'
import { ProjectDetail } from './components/ProjectDetail'
import { ProjectDrawer } from './components/ProjectDrawer'
import type { DrawerFocus } from './components/ProjectDrawer'
import { ProjectList } from './components/ProjectList'
import { QueuePanel } from './components/QueuePanel'
import { SettingsDialog } from './components/SettingsDialog'
import { BuildCenter } from './components/BuildCenter'
import { ThemeToggle } from './components/ThemeToggle'
import { AutoCheckUpdateToggle } from './components/AutoCheckUpdateToggle'
import { UpdateCheckButton } from './components/UpdateCheckButton'
import { ChangelogDialog } from './components/ChangelogDialog'
import { UpdateNoticeToast } from './components/UpdateNoticeToast'
import { UpdateBanner } from './components/UpdateBanner'
import { UpdateResultToast } from './components/UpdateResultToast'
import { Toaster, toast } from 'sonner'
import {
  EMPTY_VARIANTS,
  buildBlockedReason,
  currentProjectBlockedReason,
  enqueueTargets,
  queuedExclusionHint,
  queuedVariantMap
} from './lib/build-guard'
import { resolveBuildableVariants } from '@shared/lib/variants'
import { useBuild } from './hooks/useBuild'
import { useBuildProgress } from './hooks/useBuildProgress'
import { useDragAndDrop } from './hooks/useDragAndDrop'
import { useDrawerWidth } from './hooks/useDrawerWidth'
import { useEnvProbe } from './hooks/useEnvProbe'
import { useProjects } from './hooks/useProjects'
import { useQueue } from './hooks/useQueue'
import { useSettings } from './hooks/useSettings'
import { SIDEBAR_MAX, SIDEBAR_MIN, useSidebarWidth } from './hooks/useSidebarWidth'
import { useUpdate } from './hooks/useUpdate'
import { useWindowWidth } from './hooks/useWindowWidth'
import { trackInputMode } from './lib/input-mode'
import { resolveDrawerLayout } from './lib/layout'


export default function App(): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<string | null>(null)
  const [pendingClear, setPendingClear] = useState<'finished' | 'all' | null>(null)
  const [pendingCancelAll, setPendingCancelAll] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [drawerFocus, setDrawerFocus] = useState<DrawerFocus | null>(null)
  /** 用户手动关掉过的错误文案；出现新文案时照旧显示 */
  const [dismissedErrors, setDismissedErrors] = useState<string[]>([])
  const focusTokenRef = useRef(0)

  const {
    projects,
    loading,
    error,
    busyProjectId,
    busyKind,
    addProject,
    removeProject,
    refreshVariants,
    setVariants, refresh, reorderLocally } = useProjects()

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
  // 进度只在主进程运行期间有意义：界面这一层订阅一次，队列面板与构建记录共用
  const buildProgress = useBuildProgress()
  const env = useEnvProbe(selectedProject?.path ?? '')
  const sidebar = useSidebarWidth()
  const drawer = useDrawerWidth()
  const windowWidth = useWindowWidth()
  const update = useUpdate()
  const settings = useSettings()

  /*
   * 抽屉的宽度与「主列怎么摆」出自同一个函数：以前避让按布局常量算（1280 下 512）、
   * 抽屉按用户拖的值画（默认 560），两个数不一致时右边仍有 48px 被压住。
   */
  const drawerLayout = resolveDrawerLayout({
    windowWidth,
    sidebarWidth: sidebar.width,
    preferredWidth: drawer.preferredWidth ?? undefined
  })
  const avoidDrawer = selectedProject !== null && drawerLayout.mode === 'avoid'
  const overlapDrawer = selectedProject !== null && drawerLayout.mode === 'overlap'

  // 记录最后一次用的是键盘还是指针：抽屉按它决定要不要把焦点搬进去
  useEffect(() => trackInputMode(), [])

  /*
   * 入队前的廉价预检：只查文件系统（项目目录、gradlew、输出目录），毫秒级。
   * 结果只用来在勾选表上标一句「一眼看得出缺东西」，不拦入队。
   * 依赖用 id 拼出来的字符串：projects 每次刷新都是新数组，直接依赖会重复请求。
   */
  const projectIdsKey = projects.map((project) => project.id).join(',')
  const [preflightIssues, setPreflightIssues] = useState<Record<string, string[]>>({})
  useEffect(() => {
    if (projects.length === 0) {
      setPreflightIssues({})
      return
    }
    let cancelled = false
    void window.api.project
      .preflight(projectIdsKey.split(','))
      .then((result) => {
        if (cancelled || !result.success) {
          return
        }
        const next: Record<string, string[]> = {}
        for (const item of result.projects) {
          if (item.issues.length > 0) {
            next[item.projectId] = item.issues
          }
        }
        setPreflightIssues(next)
      })
      .catch(() => {
        // 预检失败不影响主流程：它只是提示
      })
    return () => {
      cancelled = true
    }
  }, [projectIdsKey, projects.length])

  // 设置页关掉后重读一次：抽屉里的归档预览要跟着新目录走
  useEffect(() => {
    if (!settingsOpen) {
      settings.refresh()
    }
  }, [settingsOpen, settings.refresh])

  /*
   * sonner 的通知与自己的 toast-stack 都在右下角，两个 fixed 容器会互相压住。
   * 把 sonner 的偏移量顶到 toast-stack 之上：量的是真实高度，提示条增减都跟着走。
   */
  const toastStackRef = useRef<HTMLDivElement>(null)
  const [toastStackHeight, setToastStackHeight] = useState(0)
  useEffect(() => {
    const node = toastStackRef.current
    if (!node) {
      return
    }
    const measure = (): void => {
      setToastStackHeight(node.getBoundingClientRect().height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  const selectedVariants = selectedProject?.selectedVariants ?? []
  // 与主进程同一条规则（shared/lib/variants）：列表里没显示的变体不参与构建
  const resolvedVariants = selectedProject
    ? resolveBuildableVariants({ variants: selectedProject.variants, selected: selectedVariants })
    : { buildable: [], unknownSelected: [] }
  const buildableVariants = resolvedVariants.buildable
  /**
   * 未结束队列项占用的变体。
   *
   * 口径从「项目」改成「变体」：项目跑着 v1 时再勾 v2，应当追加到当前批次，
   * 只有同一个变体重复才拦。所以这里按变体收集，不再用「项目在队列里」一刀切。
   */
  const occupiedVariants = queuedVariantMap(queue.items)
  const occupiedOf = (projectId: string | undefined): ReadonlySet<string> =>
    projectId === undefined ? EMPTY_VARIANTS : (occupiedVariants.get(projectId) ?? EMPTY_VARIANTS)

  const occupiedForSelected = occupiedOf(selectedProject?.id)
  // 这一次真正会入队的变体：已经排上的剔掉
  const freshVariants = buildableVariants.filter((name) => !occupiedForSelected.has(name))
  const queuedVariantCount = buildableVariants.length - freshVariants.length

  const projectBuilding = selectedProject
    ? queue.items.some((item) => item.projectId === selectedProject.id && item.state === 'running')
    : false

  /**
   * 单项目那一段只在这一项真的打开时存在。
   *
   * 曾经为了让「实心」淡出，关抽屉后多留 200ms 一个半透明幽灵按钮 ——
   * 结果就是左边有一小段文字残留在那儿，比硬切更难看。现在直接卸载：
   * 位置的连续性由背后那块色块负责（它从旧位置滑回「构建勾选项」）。
   */

  /*
   * 液态实心：两个构建按钮做成一个分段控件，实心是背后一块自己会跑的色块。
   *
   * 之前是「两个按钮各自淡入淡出」，看着还是闪 —— 按钮一挂载/卸载，旁边那个被顶动 87px，
   * 位置跳了一下。现在按钮位置固定（全局那个永远贴着窗口右边），只有色块在两点之间移动，
   * 宽度一起变、中途盖住两者之间的间隙，才像液体流过去。
   */
  const buildsRef = useRef<HTMLDivElement>(null)
  const allSegRef = useRef<HTMLButtonElement>(null)
  const currentSegRef = useRef<HTMLButtonElement>(null)
  // 色块对位：以**容器右边缘**为基准，而不是左边缘 —— 加进一段时容器是往左长出来的，
  // 靠左定位会跟着一起跳；靠右定位时「全局那段」永远在原位，只有色块自己滑。
  const [pill, setPill] = useState<{ right: number; width: number } | null>(null)
  const activeSeg: 'all' | 'current' = selectedProject !== null ? 'current' : 'all'

  // 环境缺失（比如 SDK 没找到）时不该让用户白等一次构建
  const envBlocking = env.result?.items.find((item) => item.state === 'error') ?? null
  // 单项目按钮的原因与勾选表那条共用同一份实现（build-guard），措辞不会走散
  const enqueueBlocked = currentProjectBlockedReason({
    variantCount: freshVariants.length,
    busy: busyProjectId !== null,
    queuedVariantCount,
    envIssue: envBlocking ? `${envBlocking.label}${envBlocking.detail ? `：${envBlocking.detail}` : ' 不可用'}` : null
  })

  const runAdd = async (path: string): Promise<void> => {
    setAddError(null)
    const failure = await addProject(path)
    if (failure) {
      setAddError(failure)
    }
  }

  const drag = useDragAndDrop((path, total) => {
    // 只取第一个是既有的实现；但用户拖了两个时要说明白，否则他会以为两个都加进去了
    if (total > 1) {
      toast.warning(`一次只能添加一个项目目录，已添加第一个（共拖入 ${total} 个）`)
    }
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
  const clearTargetCount =
    pendingClear === 'finished'
      ? queue.items.filter((item) => item.state !== 'pending' && item.state !== 'running').length
      : queue.items.length

  // 侧栏徽章仍按项目显示：这个项目有没跑完的项
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
  /*
   * 跨项目口径同样换成变体级：
   * buildableVariantCount 数的是「这次真正会入队」的变体（已剔除队列里占用的），
   * queuedVariantCount 是被剔掉的数量 —— 两者加起来才是用户勾选的总数。
   */
  const crossProject = {
    buildableVariantCount: 0,
    queuedVariantCount: 0,
    pendingProjectCount: 0,
    unknownSelectedCount: 0
  }
  for (const project of projects) {
    const resolved = projectResolutions.get(project.id)
    if (!resolved) {
      continue
    }
    const occupied = occupiedOf(project.id)
    const fresh = resolved.buildable.filter((name) => !occupied.has(name))
    crossProject.buildableVariantCount += fresh.length
    crossProject.queuedVariantCount += resolved.buildable.length - fresh.length
    crossProject.unknownSelectedCount += resolved.unknownSelected.length
    if (fresh.length > 0) {
      crossProject.pendingProjectCount += 1
    }
  }
  // 顶栏按钮与表内按钮共用同一份判断：同一个动作的两个位置，禁用条件必须字字相同
  const buildGuard = { ...crossProject }
  const crossBlocked = buildBlockedReason(buildGuard)
  const crossHint = queuedExclusionHint(buildGuard)

  // 色块对位：按钮挂载/卸载、文案变长、字体晚到、侧栏被拖动，都会挪按钮位置 ——
  // 只在依赖变化时量会留下一次错位（用户看到的就是一个没填满的空框），所以挂 ResizeObserver。
  useLayoutEffect(() => {
    const container = buildsRef.current
    if (container === null) {
      return
    }
    const sync = (): void => {
      const target = activeSeg === 'current' ? currentSegRef.current : allSegRef.current
      if (target === null) {
        return
      }
      const base = container.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      setPill({ right: Math.max(0, base.right - rect.right), width: rect.width })
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [activeSeg, freshVariants.length, crossProject.buildableVariantCount, windowWidth])

  /** 入队勾选的项目：只带上还没排上的变体，已占用的由主进程再筛一次 */
  const buildCheckedProjects = (): void => {
    const targets = enqueueTargets(projects, projectResolutions, occupiedVariants)
    if (targets.length > 0) {
      void queue.enqueue(targets)
    }
  }

  /** 「查看日志」：打开抽屉并定位到日志区（光打开抽屉的话，日志在首屏之外） */
  const showLog = (projectId: string): void => {
    setSelectedProjectId(projectId)
    focusTokenRef.current += 1
    setDrawerFocus({ section: 'log', token: focusTokenRef.current })
  }

  /** 一次补跑所有失败项：每项只重跑失败的变体，已经成功的变体不重复打 */
  const retryAllFailed = (): void => {
    for (const item of queue.items) {
      if (item.state !== 'failed') {
        continue
      }
      const failedVariants = item.runs
        .filter((run) => run.state === 'failed')
        .map((run) => run.variant)
      void queue.retry(item.id, failedVariants.length > 0 ? failedVariants : undefined)
    }
  }

  // 同一句错误可能来自两处，去重后再显示；用户关掉的只是那一条文案
  const errorMessages = Array.from(
    new Set([error, addError, queue.error, build.error].filter((value): value is string => Boolean(value)))
  ).filter((message) => !dismissedErrors.includes(message))

  const contentClass = avoidDrawer
    ? 'app-content app-content--avoid-drawer'
    : overlapDrawer
      ? 'app-content app-content--drawer-overlap'
      : 'app-content'

  return (
    <div
      className={drag.dragging ? 'app-shell app-shell--dragging' : 'app-shell'}
      style={
        {
          '--sidebar-width': `${sidebar.width}px`,
          '--drawer-width': `${drawerLayout.width}px`
        } as React.CSSProperties
      }
      onDragOver={drag.onDragOver}
      onDragLeave={drag.onDragLeave}
      onDrop={drag.onDrop}
    >
      <header className="app-topbar">
        {/*
         * 顶栏左侧：中等重量的「添加项目」+ 项目数。
         *
         * 顶栏只允许**一个实心**，给当前上下文的主动作 —— 也就是右侧的「构建勾选项」。
         * 添加项目是低频动作，用浅底 + 强边框这种中间重量：看得见、但不会盖过构建。
         * 也不套胶囊容器（试过：「按钮 │ 计数」包成一条长条，又宽又挤）。
         * 顶栏不放 logo 与应用名：任务栏、Alt+Tab、系统标题栏里都有。
         */}
        <Button
          variant="outline"
          className="app-topbar__add"
          disabled={busyKind === 'add'}
          onClick={handleAdd}
          title="选择一个 Android 项目目录加进来"
        >
          <FolderPlus size={14} aria-hidden="true" />
          {busyKind === 'add' ? '添加中…' : '添加项目'}
        </Button>
        <span className="app-topbar__status">
          {loading ? '读取项目…' : `${projects.length} 个项目`}
        </span>
        {/*
         * 顶栏不再展示「为什么不能构建」的长句：构建中心底部就在勾选列表正下方，
         * 那里已经说了一遍（同一个原因两处并列，只是措辞略不同，看着像两个说法）。
         * 顶栏这两个按钮的原因放进 title，需要时 hover 可得。
         */}
        {/*
         * 两个构建动作做成一个分段控件：背后一块实心色块在两者之间滑。
         * 顺序是「单项目（局部）」在前、「勾选项（全局）」在后 —— 全局那个永远贴着窗口右边，
         * 于是单项目按钮挂载/卸载时它不会跟着挪，位置不跳，色块才是唯一在动的东西。
         */}
        {projects.length > 0 ? (
          <div className="app-topbar__builds" ref={buildsRef}>
            <span
              className="app-topbar__builds-pill"
              aria-hidden="true"
              /*
               * 没量到位置之前给 0 宽，而不是 opacity: 0 ——
               * 淡入会在「色块还没到位、文字已经反相」的那一帧里出现白字白底（实测过）。
               * 0 宽是彻底看不见，而且不参与过渡。
               */
              style={
                pill === null
                  ? { right: 0, width: 0 }
                  : { right: `${pill.right}px`, width: `${pill.width}px` }
              }
            />
            {selectedProject !== null ? (
              <Button
                ref={currentSegRef}
                variant="ghost"
                className={
                  pill === null ? 'app-topbar__seg' : 'app-topbar__seg app-topbar__seg--active'
                }
                disabled={enqueueBlocked !== null}
                title={
                  enqueueBlocked ??
                  `构建「${selectedProject.name}」里已勾选的变体（${freshVariants.length} 个）`
                }
                onClick={() => {
                  // 只带这次真正要入队的变体：已在队列里的那些会被主进程再筛一次
                  void queue.enqueue([{ projectId: selectedProject.id, variants: freshVariants }])
                }}
              >
                <span className="app-topbar__seg-text">
                  {projectBuilding && freshVariants.length === 0
                    ? '构建中…'
                    : `构建 ${selectedProject.name}（${freshVariants.length}）`}
                </span>
              </Button>
            ) : null}
            <Button
              ref={allSegRef}
              variant="ghost"
              className={
                selectedProject === null && pill !== null
                  ? 'app-topbar__seg app-topbar__seg--active'
                  : 'app-topbar__seg'
              }
              disabled={crossBlocked !== null}
              title={crossBlocked ?? '把勾选的变体加入队列并构建'}
              onClick={buildCheckedProjects}
            >
              <span className="app-topbar__seg-text">
                构建勾选项（{crossProject.buildableVariantCount}）
              </span>
            </Button>
          </div>
        ) : null}
      </header>

      <div className="app-body">
        <aside className="app-sidebar" aria-label="项目列表">
          <div
            className="app-sidebar__resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧栏宽度"
            aria-valuenow={sidebar.width}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            tabIndex={0}
            title="拖动调整宽度，方向键也能调"
            onPointerDown={sidebar.onResizeStart}
            onKeyDown={sidebar.onResizeKeyDown}
          />
          <ProjectList
            projects={projects}
            selectedId={selectedProject?.id ?? null}
            busyProjectId={busyProjectId}
            busyKind={busyKind}
            queuedProjectIds={Array.from(queuedProjectIds)}
            onSelect={setSelectedProjectId}
            onRemove={setPendingRemove}
            onReorder={(ids) => {
              // 先乐观更新本地顺序，再发请求。
              //
              // 只做「请求 → 重取」的话，从松手到请求返回这段时间列表仍是旧顺序：
              // 拖拽态一清，卡片就弹回原位，等重取回来才跳到新位置 —— 用户看到的就是闪烁。
              // 顺序落库后仍要重取：侧栏与抽屉读同一份数据，别各留一份旧顺序。
              reorderLocally(ids)
              void window.api.project.reorder(ids).then(() => {
                refresh()
              })
            }}
          />
          {/* 左下角：主题、自动检查更新、设置、版本与检查更新（左列信息、右列控件） */}
          <div className="app-sidebar__bottom">
            <div className="app-sidebar__row">
              <span className="app-sidebar__label">主题</span>
              <ThemeToggle />
            </div>
            <div className="app-sidebar__row">
              <span className="app-sidebar__label">自动检查更新</span>
              <AutoCheckUpdateToggle />
            </div>
            <div className="app-sidebar__row">
              <button
                type="button"
                className="app-sidebar__version tabular"
                title="查看更新记录"
                onClick={() => {
                  setChangelogOpen(true)
                }}
              >
                v{update.state?.currentVersion ?? '—'}
              </button>
              <span className="app-sidebar__row-actions">
                <UpdateCheckButton />
                {/* 设置入口按导航规范放在导航区末尾（微软 / Material 的侧边导航都是这条），
                    但不再单占一行带标签 —— 那样和上面的「主题」「自动检查更新」不成一路 */}
                <button
                  type="button"
                  className="app-sidebar__icon-action"
                  aria-label="设置"
                  title="设置"
                  onClick={() => {
                    setSettingsOpen(true)
                  }}
                >
                  <Settings size={15} aria-hidden="true" />
                </button>
              </span>
            </div>
          </div>
        </aside>

        <ChangelogDialog
          open={changelogOpen}
          currentVersion={update.state?.currentVersion ?? ''}
          onClose={() => {
            setChangelogOpen(false)
          }}
        />

        {/* 右下角叠放：更新提示条、手动检查的结果、更新完成告知 —— 三者可能同时出现，叠起来才不互相压住 */}
        <div className="toast-stack" ref={toastStackRef}>
          <UpdateBanner
            queueBusy={queue.items.some((item) => item.state === 'running' || item.state === 'pending')}
          />
          <UpdateResultToast />
          <UpdateNoticeToast />
        </div>

        {/*
         * 与参考实现同一套配置：右下角、richColors、带关闭按钮；theme=system 跟随系统深浅色。
         * offset 顶到 toast-stack 之上，两个 fixed 容器才不会互相压住。
         */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          theme="system"
          offset={toastStackHeight > 0 ? toastStackHeight + 16 : 16}
        />

        {/* 拖拽是全窗口生效的：已经有项目时也要给反馈，否则用户以为这里不支持拖拽 */}
        {drag.dragging ? (
          <div className="drop-hint" role="status" aria-live="polite">
            <span className="drop-hint__title">松开就把这个文件夹加进来</span>
            {drag.fileCount > 1 ? (
              <span className="drop-hint__note">一次只能加一个：会添加其中第一个</span>
            ) : null}
          </div>
        ) : null}

        <main className={contentClass}>
          {/*
           * 四个来源的错误以前各占一条红条，叠起来能占掉半屏。合并成一条：
           * 显示最近一条，其余只报数量，用户看过了可以关掉。
           */}
          {errorMessages.length > 0 ? (
            <div className="app-errors">
              <p className="app-error" role="status" aria-live="polite">
                {errorMessages[errorMessages.length - 1]}
              </p>
              {errorMessages.length > 1 ? (
                <span className="app-errors__more tabular">
                  另有 {errorMessages.length - 1} 条其他错误
                </span>
              ) : null}
              <button
                type="button"
                className="app-errors__close"
                aria-label="关闭错误提示"
                title="关闭提示"
                onClick={() => {
                  setDismissedErrors((previous) => [...previous, ...errorMessages])
                }}
              >
                ×
              </button>
            </div>
          ) : null}

          {projects.length === 0 ? (
            <GuideCard onAdd={handleAdd} dragging={drag.dragging} />
          ) : (
            <>
              {/* 主列只放全局内容：构建中心是主操作区，队列跟着它；随选中项目变化的东西全进右侧抽屉 */}
              <BuildCenter
                projects={projects}
                busyProjectId={busyProjectId}
                queuedVariants={occupiedVariants}
                buildableVariantCount={crossProject.buildableVariantCount}
                blockedReason={crossBlocked}
                queuedHint={crossHint}
                outputRoot={settings.settings?.outputRoot ?? null}
                preflightIssues={preflightIssues}
                onSetVariants={(projectId, names) => {
                  void setVariants(projectId, names)
                }}
                onRefreshVariants={(projectId) => {
                  void refreshVariants(projectId, true)
                }}
              />

              <QueuePanel
                items={queue.items}
                concurrency={queue.concurrency}
                paused={queue.paused}
                progress={buildProgress}
                showVariantProgress={settings.settings?.showVariantProgress ?? true}
                onCancel={(itemId) => {
                  void queue.cancel(itemId)
                }}
                onRequestCancelAll={() => {
                  setPendingCancelAll(true)
                }}
                onRetry={(itemId, variants) => {
                  void queue.retry(itemId, variants)
                }}
                onRetryAllFailed={retryAllFailed}
                onRequestClear={setPendingClear}
                onConcurrencyChange={(limit) => {
                  void queue.setConcurrency(limit)
                }}
                onShowLog={showLog}
                onResume={() => {
                  void queue.resume()
                }}
              />
            </>
          )}
        </main>

        {/* 项目级内容全部收在这里。非模态：抽屉开着的时候主列的勾选照旧能改 */}
        {selectedProject ? (
          <ProjectDrawer
            project={selectedProject}
            width={drawerLayout.width}
            onResize={drawer.setWidth}
            onResizeCommit={drawer.commitWidth}
            focusSection={drawerFocus}
            onClose={() => {
              setSelectedProjectId(null)
              setDrawerFocus(null)
            }}
          >
            <ProjectDetail
              project={selectedProject}
              busyKind={busyProjectId === selectedProject.id ? busyKind : null}
              building={projectBuilding}
              occupiedVariants={Array.from(occupiedForSelected)}
              outputRoot={settings.settings?.outputRoot ?? null}
              onToggleVariant={handleToggleVariant}
              onSetVariants={(names) => {
                void setVariants(selectedProject.id, names)
              }}
              onRefreshVariants={(force) => {
                void refreshVariants(selectedProject.id, force)
              }}
              onSetAlias={(alias) => {
                // 落库后重取一次项目：抽屉与侧栏都要跟着更新，别各留一份旧值。
                // 走 refreshVariants 而不是另外加一条刷新链路 —— 它本来就会重读项目并更新列表，
                // 静态解析是毫秒级，省下一条新链路比省这一次解析更值。
                void window.api.project.setAlias(selectedProject.id, alias).then((result) => {
                  if (result.success) {
                    void refreshVariants(selectedProject.id, false)
                  }
                })
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
              progress={buildProgress}
              onLoadMore={build.loadMore}
            />
          </ProjectDrawer>
        ) : null}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
        }}
        onSaved={settings.refresh}
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

      {/* 取消会中断正在跑的构建，重新跑要再等一遍：先确认再动手 */}
      <ConfirmDialog
        open={pendingCancelAll}
        title="取消全部构建？"
        tone="destructive"
        confirmLabel="全部取消"
        message={`将取消 ${
          queue.items.filter((item) => item.state === 'running' || item.state === 'pending').length
        } 项（含正在跑的），被中断的构建要重新跑一遍。已经跑完的记录不受影响。`}
        onCancel={() => {
          setPendingCancelAll(false)
        }}
        onConfirm={() => {
          setPendingCancelAll(false)
          void queue.cancelAll()
        }}
      />

      {/* 清空队列会级联删掉构建记录：这是破坏性操作，必须说清会删多少、删什么 */}
      <ConfirmDialog
        open={pendingClear !== null}
        title={pendingClear === 'all' ? '清空全部队列记录？' : '清空已结束的队列记录？'}
        tone="destructive"
        confirmLabel="清空"
        message={`将清空 ${clearTargetCount} 条队列记录，同时删除它们对应的构建记录（已经复制到输出目录的 APK 不会被删）。`}
        onCancel={() => {
          setPendingClear(null)
        }}
        onConfirm={() => {
          if (pendingClear) {
            void queue.clear(pendingClear)
          }
          setPendingClear(null)
        }}
      />
    </div>
  )
}
