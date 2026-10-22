import { useEffect, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { X, RotateCcw, Trash2, FileText, FolderOpen, ChevronDown } from 'lucide-react'
import { QUEUE_CONCURRENCY, QUEUE_LIST_LIMIT } from '@shared/constants/queue'
import type { BuildProgress } from '@shared/types/build'
import type { QueueItem, QueueItemState, QueueRunDetail } from '@shared/types/queue'
import { useNow } from '../hooks/useNow'
import { progressCountText, progressHeadline } from '@shared/lib/build-stage'
import { splitByCurrentBatch } from '../lib/queue-batch'
import { computeBatchProgress } from '../lib/queue-progress'
import { groupAttempts, type AttemptGroupSummary } from '../lib/queue-attempts'
import { formatDateTime, formatDurationMs } from '../lib/duration'
import { variantProgressPercent } from '../lib/variant-progress'
import { isSingleVariantItem, itemWaitText, NOT_STARTED_TEXT, variantTimingText } from '../lib/queue-row'
import { dirnameOf } from '../lib/path-display'
import { openPathOrToast } from '../lib/open-path'
import { buildStateBadgeClass } from '../lib/state-badge'

const STATE_LABEL: Record<QueueItemState, string> = {
  pending: '排队中',
  running: '构建中',
  success: '成功',
  failed: '失败',
  canceled: '已取消'
}

const RUN_STATE_LABEL: Record<QueueRunDetail['state'], string> = {
  running: '构建中',
  success: '成功',
  failed: '失败',
  canceled: '已取消'
}

/** 变体太多时只列前几个，避免一条队列项撑满整屏 */
const RUN_DETAIL_LIMIT = 8

/** 选项由共享常量生成，避免界面和主进程各写一份上限 */
function concurrencyOptions(): Array<{ value: number; label: string }> {
  const options: Array<{ value: number; label: string }> = []
  for (let value = QUEUE_CONCURRENCY.MIN; value <= QUEUE_CONCURRENCY.MAX; value += 1) {
    options.push({ value, label: value === QUEUE_CONCURRENCY.MIN ? `${value}（最稳）` : String(value) })
  }
  return options
}

/** 每个变体自己的耗时文案统一走 lib/queue-row（那里可单测，规则也更复杂） */
/**
 * 这一项从入队到现在（或到结束）的总耗时。
 *
 * `now` 由外面的 1 秒心跳给 —— 以前这里直接用 `Date.now()`，于是只有队列数据刷新时数字才跳一下，
 * 看起来就是「跳段」：同一个文件里单个变体的耗时走了心跳，总耗时却没走。
 */
function formatItemDuration(item: QueueItem, now: number): string {
  const start = item.startedAt ?? item.enqueuedAt
  const end = item.finishedAt ?? now
  return formatDurationMs(Math.max(0, end - start))
}

/** 这一项里第一个有产物的成功变体 —— 同一次构建的产物落在同一个目录 */
function firstArtifactPath(item: QueueItem): string | null {
  const run = item.runs.find((candidate) => candidate.state === 'success' && candidate.apkPath !== null)
  return run?.apkPath ?? null
}

export function QueuePanel({
  items,
  concurrency,
  paused,
  progress,
  showVariantProgress,
  onCancel,
  onRequestCancelAll,
  onRetry,
  onRetryAllFailed,
  onRequestClear,
  onConcurrencyChange,
  onShowLog,
  onResume
}: {
  items: QueueItem[]
  concurrency: number
  /** 队列停在暂停态：上次退出留下了没跑的项，等用户决定是否续跑 */
  paused: boolean
  /** 正在跑的变体进度，键是构建记录 id */
  progress: Record<string, BuildProgress>
  /** 是否给正在构建的变体画进度条（设置项；关掉后连「预计」文案也不显示） */
  showVariantProgress: boolean
  onCancel: (itemId: string) => void
  /** 请求全部取消；确认由上层弹（会中断正在跑的构建） */
  onRequestCancelAll: () => void
  /** 重试；给出 variants 时只重跑这些变体 */
  onRetry: (itemId: string, variants?: string[]) => void
  /** 一次重试所有失败项（各自只重跑失败的变体） */
  onRetryAllFailed: () => void
  /** 请求清空；确认由上层弹（清空会连带删除构建记录，必须先说清） */
  onRequestClear: (scope: 'finished' | 'all') => void
  onConcurrencyChange: (limit: number) => void
  /** 跳到某个项目的构建记录（看日志） */
  onShowLog: (projectId: string) => void
  onResume: () => void
}): React.JSX.Element {
  const pending = items.filter((item) => item.state === 'pending')
  const running = items.filter((item) => item.state === 'running')
  const finished = items.filter((item) => item.state !== 'pending' && item.state !== 'running')
  const failedItems = items.filter((item) => item.state === 'failed')
  const hasRunning = running.length > 0
  /** 队列里还有没跑完的项：进度条只在有活可干时显示，跑完之后由「本批用时」接手 */
  const hasActiveItems = hasRunning || pending.length > 0
  const now = useNow(hasRunning)

  // 取消请求发出后进程要过一会儿才退出，先本地标记「取消中」，别让用户以为没点上
  const [canceling, setCanceling] = useState<Set<string>>(new Set())

  /**
   * 顶部两个计数同时是筛选开关：队列一长，找正在跑的那条要滚半天。
   * 单选（再次点击同一项即取消筛选），与列表的排序规则无关，只影响「显示哪些」。
   */
  const [stateFilter, setStateFilter] = useState<'running' | 'pending' | null>(null)

  /** 更早批次的展开状态：默认收起，看一眼历史再展开 */
  const [showOlder, setShowOlder] = useState(false)

  /** 「清空…」小菜单：两个破坏性动作收进去，头部就少两个常驻按钮 */
  const [clearMenuOpen, setClearMenuOpen] = useState(false)
  const clearMenuRef = useRef<HTMLSpanElement>(null)
  const clearMenuPanelRef = useRef<HTMLDivElement>(null)
  const clearMenuTriggerRef = useRef<HTMLButtonElement>(null)
  /**
   * 关闭原因。**只有键盘（Esc）关闭才把焦点送回触发按钮**：
   * - 点菜单外：用户点的是别的控件，焦点该留在那儿，抢回来等于让他点不动；
   * - 选菜单项：紧接着弹确认框，焦点归确认框。
   */
  const clearMenuCloseReasonRef = useRef<'escape' | 'outside' | 'choose' | null>(null)
  /** 是否真的打开过。这个 effect 在挂载时也会跑一次（初值 false），那时不该抢焦点 */
  const clearMenuWasOpenRef = useRef(false)

  useEffect(() => {
    if (!clearMenuOpen) {
      return
    }
    const panel = clearMenuPanelRef.current
    const items = panel
      ? Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
      : []
    // 焦点进第一个「可用」项：首项可能因为「没有已结束的项」而被禁用
    items[0]?.focus()

    const handlePointerDown = (event: PointerEvent): void => {
      if (clearMenuRef.current !== null && !clearMenuRef.current.contains(event.target as Node)) {
        clearMenuCloseReasonRef.current = 'outside'
        setClearMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        clearMenuCloseReasonRef.current = 'escape'
        setClearMenuOpen(false)
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
        return
      }
      if (items.length === 0) {
        return
      }
      // 菜单里方向键要能走：否则读屏念叨「菜单」，用户按方向键却没反应
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = (current + step + items.length) % items.length
      items[next]?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [clearMenuOpen])

  // 关闭后归还焦点：只在「键盘关闭」这一条路径上做（见 clearMenuCloseReasonRef 的说明）。
  // 挂载时这个 effect 也会跑（初值 false），由 clearMenuWasOpenRef 挡掉。
  useEffect(() => {
    if (clearMenuOpen) {
      clearMenuWasOpenRef.current = true
      return
    }
    if (!clearMenuWasOpenRef.current) {
      return
    }
    clearMenuWasOpenRef.current = false
    const reason = clearMenuCloseReasonRef.current
    clearMenuCloseReasonRef.current = null
    if (reason === 'escape') {
      clearMenuTriggerRef.current?.focus()
    }
  }, [clearMenuOpen])

  /** 同一项目更早几次尝试的展开状态：同样默认收起 */
  const [showSuperseded, setShowSuperseded] = useState(false)

  useEffect(() => {
    setCanceling((previous) => {
      const next = new Set(
        Array.from(previous).filter((id) =>
          items.some((item) => item.id === id && (item.state === 'running' || item.state === 'pending'))
        )
      )
      return next.size === previous.size ? previous : next
    })
  }, [items])

  // 队列状态变化只用视觉颜色表达，键盘/读屏用户需要一句播报
  const [announcement, setAnnouncement] = useState('')
  const seenStates = useRef(new Map<string, QueueItemState>())

  useEffect(() => {
    const seen = seenStates.current
    let message = ''
    for (const item of items) {
      const previous = seen.get(item.id)
      if (previous !== undefined && previous !== item.state) {
        message = `${item.projectName}：${STATE_LABEL[item.state]}`
      }
      seen.set(item.id, item.state)
    }
    if (message !== '') {
      setAnnouncement(message)
    }
  }, [items])

  /**
   * 本批进度：分母是本批变体总数（跑完的项仍留在分母里），分子是本批已结束的变体数。
   *
   * 以前分母只算「还没结束的项」，一项跑完就整项退出统计 —— 分母越来越少、
   * 分子恒为 0，看起来像卡死。整批收工时归零，进度条随之消失。
   */
  const batchProgress = computeBatchProgress(items)
  const totalVariants = batchProgress.total
  const doneVariants = batchProgress.done
  const percent =
    totalVariants === 0 ? 0 : Math.min(100, Math.round((doneVariants / totalVariants) * 100))

  /**
   * 按批次切一刀：当前这一批留在主列表，更早的默认折叠。
   *
   * 只折叠不删除 —— 构建记录是队列项的子表（外键级联），删队列项会把历史记录一起删掉。
   * 想让它们彻底消失仍然走「清空记录」菜单（菜单项为「清空已结束的 / 清空全部」），那一步会明确说明连带删除构建记录。
   */
  const batches = splitByCurrentBatch(items)
  /**
   * 同一项目的多次重试合并成一条：重试是新建一条项（attempt + 1），
   * 旧的留在队列里能把上一次的失败原因查到，但并排两张卡片看着像重复。
   * 这里只合并展示，数据一条不删。
   */
  const attempts = groupAttempts(batches.current)
  // 筛选只影响「显示哪些」，不影响进度统计与排序规则
  const filterState = (list: QueueItem[]): QueueItem[] =>
    stateFilter === null ? list : list.filter((item) => item.state === stateFilter)
  const visibleCurrent = filterState(attempts.primary)
  const visibleSuperseded = filterState(attempts.superseded)
  const visibleOlder = filterState(batches.older)

  /**
   * 一条队列项的完整渲染。
   *
   * 当前批与「更早的记录」共用这一份：两处各写一遍的话，按钮与状态文案迟早走散。
   * `summary` 只给合并后的代表项：说明还有几次更早的尝试、这次是不是只补跑了部分变体。
   */
  const renderItem = (item: QueueItem, summary?: AttemptGroupSummary): React.JSX.Element => {
    const isCanceling = canceling.has(item.id)
    const startedVariants = new Set(item.runs.map((run) => run.variant))
    const notStarted = item.variants.filter((variant) => !startedVariants.has(variant))
    const failedRuns = item.runs.filter((run) => run.state === 'failed')
    const artifactPath = firstArtifactPath(item)

    /*
     * 单变体项只渲染一行：项目名、变体名、状态、阶段、时间、动作全在这一行，
     * 进度条在下面单独一条。以前它是「项行 + 变体行」两行，8 个项目各一个变体时，
     * 一半的垂直空间在说同一件事。
     *
     * 判定看 item.variants（入队时冻结的声明列表），不看 runs —— 还没开跑的项 runs 是空的。
     */
    const single = isSingleVariantItem(item)
    const singleVariantName = item.variants[0] ?? ''
    const singleRun = single ? (item.runs[0] ?? null) : null
    const singleProgress = singleRun && singleRun.state === 'running' ? progress[singleRun.id] : undefined
    const singleStage = singleProgress ? progressHeadline(singleProgress) : null
    const singleCount = singleProgress ? progressCountText(singleProgress) : null
    const singlePercent = singleRun ? variantProgressPercent(singleRun, now, showVariantProgress) : null

    /** 这一项从入队（或开始）到现在/结束的毫秒数：项级「等待」用它套阈值 */
    const itemElapsedMs = (): number =>
      Math.max(0, (item.finishedAt ?? now) - (item.startedAt ?? item.enqueuedAt))

    /**
     * 变体行的时间文案：`等待 x · 构建 y · 预计 z` / `耗时 z` / `未开始`。
     * 「等待」的取值是「从入队到这个变体开始」，包含前面变体的构建时间 —— 所以不叫「排队」。
     */
    const timingOf = (run: QueueRunDetail): string =>
      variantTimingText({
        state: run.state,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        estimatedMs: run.estimatedMs,
        waitMs: run.startedAt === null ? null : Math.max(0, run.startedAt - item.enqueuedAt),
        showEstimate: showVariantProgress,
        now
      })

    return (
      <li key={item.id} className={single ? 'queue-list__item queue-list__item--single' : 'queue-list__item'}>
        <div className="queue-list__row">
          <span className="queue-list__project">{item.projectName}</span>
          {/* 单变体项把变体名提到这一行：它就是这一项的全部内容 */}
          {single ? (
            <span className="run-detail__variant tabular" title={singleVariantName}>
              {singleVariantName}
            </span>
          ) : null}
          <span className={buildStateBadgeClass(item.state)}>
            {isCanceling ? '取消中…' : STATE_LABEL[item.state]}
          </span>
          {/* 单变体项的阶段也提到这一行，与多变体项的子行同一套措辞 */}
          {single && singleStage ? (
            <span
              className="run-detail__stage"
              title={singleProgress?.task ?? undefined}
              aria-label={'当前阶段：' + singleStage}
            >
              {singleStage}
              {singleCount !== null ? (
                <span className="run-detail__stage-count tabular"> · {singleCount}</span>
              ) : null}
            </span>
          ) : null}
          {item.attempt > 1 ? (
            <Badge
              variant="muted"
              className="tabular"
              title={
                summary !== undefined && summary.earlierCount > 0
                  ? `第 ${item.attempt} 次尝试；更早的 ${summary.earlierCount} 次收在下方「更早的尝试」里`
                  : undefined
              }
            >
              第 {item.attempt} 次
            </Badge>
          ) : null}
          <span className="queue-list__duration tabular">
            {single
              ? singleRun
                ? timingOf(singleRun)
                : itemWaitText(itemElapsedMs())
              : item.state === 'running'
                ? `已用 ${formatItemDuration(item, now)}`
                : item.state === 'pending'
                  ? itemWaitText(itemElapsedMs())
                  : `耗时 ${formatItemDuration(item, now)}`}
          </span>

          {item.state === 'running' || item.state === 'pending' ? (
            <>
              {/*
               * 查看详情走一个显式入口，而不是把整行做成可点：这一行里已经有取消、查看日志、
               * 重新构建，整行可点会让辅助技术分不清点的是什么（嵌套交互式控件）
               */}
              <Button
                variant="ghost"
                onClick={() => {
                  onShowLog(item.projectId)
                }}
              >
                <FolderOpen size={14} aria-hidden="true" />
                查看日志
              </Button>
              <Button
                variant="ghost"
                disabled={isCanceling}
                onClick={() => {
                  markCanceling(item.id)
                  onCancel(item.id)
                }}
              >
                <X size={14} aria-hidden="true" />
                {isCanceling ? '取消中…' : '取消'}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  onShowLog(item.projectId)
                }}
              >
                <FileText size={14} aria-hidden="true" />
                查看日志
              </Button>
              {/* 出包后最常做的是「去拿包」：以前只能切到汇总面板再翻目录 */}
              {artifactPath ? (
                <Button
                  variant="ghost"
                  title={dirnameOf(artifactPath)}
                  onClick={() => {
                    void openPathOrToast(dirnameOf(artifactPath), '产物目录')
                  }}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  打开产物目录
                </Button>
              ) : null}
              {failedRuns.length > 0 ? (
                <Button
                  variant="ghost"
                  title="只重跑失败的变体，已成功的变体不重复打"
                  onClick={() => {
                    onRetry(
                      item.id,
                      failedRuns.map((run) => run.variant)
                    )
                  }}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  重试失败变体（{failedRuns.length}）
                </Button>
              ) : null}
              <Button
                variant="ghost"
                title={
                  failedRuns.length > 0 ? '整项重跑，包含已经成功的变体' : '重新构建这一项'
                }
                onClick={() => {
                  onRetry(item.id)
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                重新构建
              </Button>
            </>
          )}
        </div>

        {/* 单变体项的进度条：与多变体子行里那条同一套语义（耗时比例，不是 Gradle 进度） */}
        {single && singlePercent !== null ? (
          <div
            className="run-detail__progress"
            role="progressbar"
            aria-label={singleVariantName + ' 构建进度'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={singlePercent}
            title="按该变体最近几次成功构建的耗时中位数估算，不是 Gradle 的真实进度"
          >
            <div className="run-detail__progress-fill" style={{ width: singlePercent + '%' }} />
          </div>
        ) : null}

        {/* 只有多变体项才展开子行；未开跑的项也走子行，不再用「待构建：a、b」这种整句 */}
        {single ? null : item.runs.length > 0 || notStarted.length > 0 ? (
          <ul className="run-detail">
            {item.runs.slice(0, RUN_DETAIL_LIMIT).map((run) => {
              const runProgress = run.state === 'running' ? progress[run.id] : undefined
              const stage = runProgress ? progressHeadline(runProgress) : null
              const count = runProgress ? progressCountText(runProgress) : null
              const percent = variantProgressPercent(run, now, showVariantProgress)
              return (
                <li key={run.variant} className="run-detail__item">
                  <div className="run-detail__main">
                    <span className="run-detail__variant tabular" title={run.variant}>
                      {run.variant}
                    </span>
                    <span className={buildStateBadgeClass(run.state)}>{RUN_STATE_LABEL[run.state]}</span>
                    {/* 正在跑的变体给到「在哪一步」：以前只有「构建中」，看不出在编译还是卡在下载 */}
                    {stage ? (
                      <span
                        className="run-detail__stage"
                        title={runProgress?.task ?? undefined}
                        aria-label={'当前阶段：' + stage}
                      >
                        {stage}
                        {count !== null ? <span className="run-detail__stage-count tabular"> · {count}</span> : null}
                      </span>
                    ) : null}
                    {/* 这一项的总耗时在最上面那行；这里是这个变体的等待与构建 */}
                    <span className="run-detail__time tabular">{timingOf(run)}</span>
                  </div>
                  {/*
                   * 进度条按「已用 ÷ 该变体历史成功耗时的中位数」画，是耗时比例而非 Gradle 进度，
                   * 所以 title 与无障碍文案都要写明依据；没有历史样本时整条不渲染，不画 0% 空条。
                   */}
                  {percent !== null ? (
                    <div
                      className="run-detail__progress"
                      role="progressbar"
                      aria-label={`${run.variant} 构建进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      title="按该变体最近几次成功构建的耗时中位数估算，不是 Gradle 的真实进度"
                    >
                      <div className="run-detail__progress-fill" style={{ width: percent + '%' }} />
                    </div>
                  ) : null}
                </li>
              )
            })}
            {notStarted.map((variant) => (
              <li key={variant} className="run-detail__item run-detail__item--todo">
                <div className="run-detail__main">
                  <span className="run-detail__variant tabular" title={variant}>
                    {variant}
                  </span>
                  <Badge variant="muted">{NOT_STARTED_TEXT}</Badge>
                  <span className="run-detail__time tabular">{NOT_STARTED_TEXT}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {item.runs.length + notStarted.length > RUN_DETAIL_LIMIT ? (
          <p className="queue-list__more tabular">
            …还有 {item.runs.length + notStarted.length - RUN_DETAIL_LIMIT} 个变体
          </p>
        ) : null}

        {/*
         * 失败原因全部摆出来：以前只显示第一条，一个项目挂两个变体时
         * 第二个为什么挂就得自己切进抽屉翻日志
         */}
        {failedRuns.length > 0 ? (
          <ul className="queue-list__hints">
            {failedRuns.map((run) => (
              <li key={`${run.variant}-fail`} className="queue-list__hint">
                {run.variant} 失败：{run.failureHint ?? '没有拿到具体原因，打开日志看看'}
              </li>
            ))}
          </ul>
        ) : null}

        {failedRuns[0]?.apkPath === null && failedRuns[0]?.logPath ? (
          <p className="queue-list__path tabular">
            <FolderOpen size={12} aria-hidden="true" />
            {failedRuns[0].logPath}
          </p>
        ) : null}

        {/*
         * 只补跑了部分变体时明说：合并成一条之后，「8 个变体挂 1 个、只重跑那 1 个」
         * 看起来会像整项重跑过一遍
         */}
        {summary !== undefined && summary.scopeSize > summary.rerunSize ? (
          <p className="queue-list__attempt-note">
            本次只补跑了 {summary.rerunSize} 个变体，另外 {summary.scopeSize - summary.rerunSize}{' '}
            个在上一次已经完成
          </p>
        ) : null}

        {item.note ? <p className="queue-list__note">{item.note}</p> : null}
        {item.finishedAt ? (
          <p className="queue-list__finished tabular">完成 {formatDateTime(item.finishedAt)}</p>
        ) : null}
      </li>
    )
  }

  const markCanceling = (itemId: string): void => {
    setCanceling((previous) => new Set(previous).add(itemId))
  }

  return (
    <section className="card-shell">
      <div className="card-core card-core--pad queue-panel">
        <p className="visually-hidden" role="status" aria-live="polite">
          {announcement}
        </p>

        <header className="queue-panel__head">
          <h2 className="queue-panel__title">队列</h2>
          {/* 这两个数字同时是筛选开关：队列一长，找正在跑的那条要滚半天 */}
          <button
            type="button"
            className={
              stateFilter === 'running'
                ? 'queue-panel__filter queue-panel__filter--running queue-panel__filter--on'
                : 'queue-panel__filter queue-panel__filter--running'
            }
            aria-pressed={stateFilter === 'running'}
            title={stateFilter === 'running' ? '取消筛选，显示全部' : '只看正在构建的项'}
            onClick={() => {
              setStateFilter(stateFilter === 'running' ? null : 'running')
            }}
          >
            构建中 <span className="tabular">{running.length}</span>
          </button>
          <button
            type="button"
            className={
              stateFilter === 'pending'
                ? 'queue-panel__filter queue-panel__filter--pending queue-panel__filter--on'
                : 'queue-panel__filter queue-panel__filter--pending'
            }
            aria-pressed={stateFilter === 'pending'}
            title={stateFilter === 'pending' ? '取消筛选，显示全部' : '只看排队中的项'}
            onClick={() => {
              setStateFilter(stateFilter === 'pending' ? null : 'pending')
            }}
          >
            排队 <span className="tabular">{pending.length}</span>
          </button>
          {/* 并发上限是设置，不是动作：跟信息放一起，动作按钮留给右边的动作组 */}
          <label
            className="queue-panel__concurrency"
            title="改完立即生效；正在跑的构建不会被打断"
          >
            并发上限
            <select
              className="input queue-panel__select"
              value={concurrency}
              onChange={(event) => {
                onConcurrencyChange(Number.parseInt(event.target.value, 10))
              }}
            >
              {concurrencyOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <span className="queue-panel__actions">
            {/* 批量场景下逐项点「重新构建」是重复劳动；这里一次补跑所有失败的项 */}
            {failedItems.length > 0 ? (
              <Button
                variant="ghost"
                title="每个失败项只重跑失败的变体，已成功的变体不重复打"
                onClick={onRetryAllFailed}
              >
                <RotateCcw size={14} aria-hidden="true" />
                重试失败项（{failedItems.length}）
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={pending.length + running.length === 0}
              title="会中断正在跑的构建，重新跑要再等一遍"
              onClick={() => {
                onRequestCancelAll()
              }}
            >
              <X size={14} aria-hidden="true" />
              全部取消
            </Button>
            {/*
              两个清空动作收进一个菜单：以前它们是两个常驻的破坏性按钮，与「全部取消」并排，
              一行挤着 4 个动作，主次也分不清。菜单项仍然走同一个确认框。
            */}
            <span className="queue-menu" ref={clearMenuRef}>
              <Button
                variant="ghost"
                ref={clearMenuTriggerRef}
                aria-haspopup="menu"
                aria-expanded={clearMenuOpen}
                aria-controls={clearMenuOpen ? 'queue-clear-menu' : undefined}
                title="清空队列记录（已结束的 / 全部）"
                disabled={finished.length === 0 && items.length === 0}
                onClick={() => {
                  setClearMenuOpen(!clearMenuOpen)
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                清空记录
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
              {clearMenuOpen ? (
                <div
                  id="queue-clear-menu"
                  ref={clearMenuPanelRef}
                  className="queue-menu__panel"
                  role="menu"
                  aria-label="清空队列记录"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="queue-menu__item"
                    disabled={finished.length === 0}
                    onClick={() => {
                      clearMenuCloseReasonRef.current = 'choose'
                      // 先把焦点交回触发按钮：确认框记的是「打开时的焦点元素」作为归还目标，
                      // 若此刻焦点还在即将卸载的菜单项上，取消后焦点会掉到 BODY
                      clearMenuTriggerRef.current?.focus()
                      setClearMenuOpen(false)
                      onRequestClear('finished')
                    }}
                  >
                    清空已结束的（{finished.length} 条）
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="queue-menu__item"
                    disabled={items.length === 0}
                    onClick={() => {
                      clearMenuCloseReasonRef.current = 'choose'
                      clearMenuTriggerRef.current?.focus()
                      setClearMenuOpen(false)
                      onRequestClear('all')
                    }}
                  >
                    清空全部（{items.length} 条）
                  </button>
                  <p className="queue-menu__hint">构建记录一并删除，产物文件与耗时统计不动</p>
                </div>
              ) : null}
            </span>
          </span>
        </header>

        {/*
         * 本批进度：分母是「这次还要打的变体总数」，可靠；Gradle 内部不掺百分比，
         * 具体到哪一步看下面每个变体行里的阶段。
         *
         * 统计行（n/N 完成 · 用时 x）整批跑完后仍留着 —— 收工那一刻才是最想看总时长的时候；
         * 只有进度条本身在有活可干时才画。两者分开控制。
         */}
        {totalVariants > 0 ? (
          <div className="queue-progress">
            <p
              className="queue-progress__text tabular"
              title={
                batchProgress.since === null
                  ? undefined
                  : '用时从这一批第一项入队算起，包含排队等待；不是各变体构建耗时的相加'
              }
            >
              {doneVariants}/{totalVariants} 完成
              {batchProgress.since !== null
                ? ` · ${batchProgress.until === null ? '已用' : '用时'} ${formatDurationMs(
                    (batchProgress.until ?? now) - batchProgress.since
                  )}`
                : ''}
            </p>
            {hasActiveItems ? (
              <div
                className="queue-progress__track"
                role="progressbar"
                aria-label="本批变体构建进度"
                aria-valuemin={0}
                aria-valuemax={totalVariants}
                aria-valuenow={doneVariants}
              >
                <div className="queue-progress__fill" style={{ width: percent + '%' }} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/*
         * 暂停态要明说：启动时如果有上次没跑的项，队列不会自己开跑，
         * 不说的话用户看到「排队中」却一直不动，只会以为卡住了。
         */}
        {paused ? (
          <p className="queue-panel__paused" role="status" aria-live="polite">
            {pending.length > 0
              ? `上次退出时有 ${pending.length} 项没跑完，队列先停着没自动开跑。`
              : '队列停在暂停态，没有自动开跑。'}
            <Button variant="outline" onClick={onResume}>
              继续上次队列
            </Button>
          </p>
        ) : null}

        {items.length === 0 ? (
          <p className="queue-panel__empty">
            队列是空的。选好变体后点顶栏右上的「构建勾选项」；打开某个项目的抽屉时，顶栏还会出现「构建
            &lt;项目名&gt;」。
          </p>
        ) : visibleCurrent.length === 0 ? (
          <p className="queue-panel__empty">
            当前没有{stateFilter === 'running' ? '正在构建' : '排队中'}的项。
            <Button
              variant="ghost"
              onClick={() => {
                setStateFilter(null)
              }}
            >
              显示全部
            </Button>
          </p>
        ) : (
          <ul className="queue-list">
            {visibleCurrent.map((item) => renderItem(item, attempts.summaries.get(item.id)))}
          </ul>
        )}

        {/*
         * 同一项目更早的尝试默认收起：重试出来的旧项留在队列里是为了能查到上次的失败原因，
         * 不是为了让它们和这一次并排占半屏。只折叠不删除，构建记录一条不少。
         */}
        {visibleSuperseded.length > 0 ? (
          <div className="queue-panel__older">
            <Button
              variant="ghost"
              aria-expanded={showSuperseded}
              onClick={() => {
                setShowSuperseded(!showSuperseded)
              }}
            >
              {showSuperseded
                ? '收起更早的尝试'
                : `更早的尝试（${visibleSuperseded.length}）`}
            </Button>
            {showSuperseded ? (
              <ul className="queue-list queue-list--older">
                {visibleSuperseded.map((item) => renderItem(item))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/*
         * 更早的批次默认收起：跑完一批再勾下一批时，前一批的完成记录不该继续占着面板。
         * 只折叠不删除 —— 构建记录是队列项的子表（外键级联），删了历史记录也就没了。
         */}
        {visibleOlder.length > 0 ? (
          <div className="queue-panel__older">
            <Button
              variant="ghost"
              aria-expanded={showOlder}
              onClick={() => {
                setShowOlder(!showOlder)
              }}
            >
              {showOlder ? '收起更早的记录' : `更早的记录（${visibleOlder.length}）`}
            </Button>
            {showOlder ? (
              <ul className="queue-list queue-list--older">
                {visibleOlder.map((item) => renderItem(item))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {items.length >= QUEUE_LIST_LIMIT ? (
          <p className="queue-list__more tabular">
            只显示最近 {QUEUE_LIST_LIMIT} 条，更早的可以「清空记录」→「清空已结束的」后再入队
          </p>
        ) : null}
      </div>
    </section>
  )
}
