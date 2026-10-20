import { useEffect, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { X, RotateCcw, Trash2, FileText, FolderOpen } from 'lucide-react'
import { QUEUE_CONCURRENCY, QUEUE_LIST_LIMIT } from '@shared/constants/queue'
import type { BuildProgress } from '@shared/types/build'
import type { QueueItem, QueueItemState, QueueRunDetail } from '@shared/types/queue'
import { useNow } from '../hooks/useNow'
import { progressCountText, progressHeadline } from '@shared/lib/build-stage'
import { splitByCurrentBatch } from '../lib/queue-batch'
import { formatDateTime, formatDurationMs } from '../lib/duration'
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

/** 每个变体自己的构建耗时：跑着的用 startedAt 现算，跑完用落库的 durationMs */
function runDurationText(run: QueueRunDetail, now: number): string {
  if (run.state === 'running' && run.startedAt !== null) {
    // 用「构建」而不是「已用」：这一行左边还有一项级总耗时，两个都叫「已用」会分不清是哪个
    return `构建 ${formatDurationMs(Math.max(0, now - run.startedAt))}`
  }
  if (run.durationMs !== null) {
    return `耗时 ${formatDurationMs(run.durationMs)}`
  }
  return '未开始'
}

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
   * 本批进度：只算还没结束的项。
   *
   * 已结束的项不进分母，否则全部跑完后进度条会停在某处（或 100%）不消失；
   * 一只分子分母都是「这次还在路上的活」，收工即归零、整块不显示。
   */
  const activeItems = [...pending, ...running]
  const totalVariants = activeItems.reduce((sum, item) => sum + item.variants.length, 0)
  // 已结束的 run 都算完成：一条项里前面的变体跑完了，它属于「已完成」
  const doneVariants = activeItems.reduce(
    (sum, item) => sum + item.runs.filter((run) => run.state !== 'running').length,
    0
  )
  const runningVariants = running.reduce(
    (sum, item) => sum + item.runs.filter((run) => run.state === 'running').length,
    0
  )
  const percent = totalVariants === 0 ? 0 : Math.round((doneVariants / totalVariants) * 100)

  /**
   * 按批次切一刀：当前这一批留在主列表，更早的默认折叠。
   *
   * 只折叠不删除 —— 构建记录是队列项的子表（外键级联），删队列项会把历史记录一起删掉。
   * 想让它们彻底消失仍然走「清空队列记录」，那一步会明确说明连带删除构建记录。
   */
  const batches = splitByCurrentBatch(items)
  // 筛选只影响「显示哪些」，不影响进度统计与排序规则
  const filterState = (list: QueueItem[]): QueueItem[] =>
    stateFilter === null ? list : list.filter((item) => item.state === stateFilter)
  const visibleCurrent = filterState(batches.current)
  const visibleOlder = filterState(batches.older)

  /**
   * 一条队列项的完整渲染。
   *
   * 当前批与「更早的记录」共用这一份：两处各写一遍的话，按钮与状态文案迟早走散。
   */
  const renderItem = (item: QueueItem): React.JSX.Element => {
    const isCanceling = canceling.has(item.id)
    const startedVariants = new Set(item.runs.map((run) => run.variant))
    const notStarted = item.variants.filter((variant) => !startedVariants.has(variant))
    const failedRuns = item.runs.filter((run) => run.state === 'failed')
    const artifactPath = firstArtifactPath(item)

    return (
      <li key={item.id} className="queue-list__item">
        <div className="queue-list__row">
          <span className="queue-list__project">{item.projectName}</span>
          <span className={buildStateBadgeClass(item.state)}>
            {isCanceling ? '取消中…' : STATE_LABEL[item.state]}
          </span>
          {item.attempt > 1 ? (
            <Badge variant="muted" className="tabular">第 {item.attempt} 次</Badge>
          ) : null}
          <span className="queue-list__duration tabular">
            {item.state === 'running'
              ? `已用 ${formatItemDuration(item, now)}`
              : formatItemDuration(item, now)}
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

        {item.runs.length > 0 ? (
          <ul className="run-detail">
            {item.runs.slice(0, RUN_DETAIL_LIMIT).map((run) => {
              const runProgress = run.state === 'running' ? progress[run.id] : undefined
              const stage = runProgress ? progressHeadline(runProgress) : null
              const count = runProgress ? progressCountText(runProgress) : null
              return (
                <li key={run.variant} className="run-detail__item">
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
                  {/* 三段计时分开给：这一项的总耗时在最上面那行，这里是这个变体的排队与构建 */}
                  <span className="run-detail__time tabular">
                    {run.startedAt !== null
                      ? `排队 ${formatDurationMs(Math.max(0, run.startedAt - item.enqueuedAt))} · `
                      : ''}
                    {runDurationText(run, now)}
                  </span>
                </li>
              )
            })}
            {notStarted.map((variant) => (
              <li key={variant} className="run-detail__item run-detail__item--todo">
                <span className="run-detail__variant tabular" title={variant}>
                  {variant}
                </span>
                <Badge variant="muted">未开始</Badge>
                <span className="run-detail__time tabular">—</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="queue-list__variants tabular">待构建：{item.variants.join('、')}</p>
        )}

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
            <Button
              variant="ghost"
              disabled={finished.length === 0}
              title={`清空 ${finished.length} 条已结束的队列记录（同时删除它们对应的构建记录，产物文件不删）`}
              onClick={() => {
                onRequestClear('finished')
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              清空队列记录
            </Button>
            <Button
              variant="ghost"
              disabled={items.length === 0}
              title={`清空全部 ${items.length} 条队列记录（同时删除对应的构建记录，产物文件不删）`}
              onClick={() => {
                onRequestClear('all')
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              清空全部
            </Button>
          </span>
        </header>

        {/*
         * 本批进度条：分母是「这次还要打的变体总数」，可靠；Gradle 内部不掺百分比，
         * 具体到哪一步看下面每个变体行里的阶段。
         */}
        {totalVariants > 0 ? (
          <div className="queue-progress">
            <p className="queue-progress__text tabular">
              变体 {doneVariants}/{totalVariants} 完成
              {runningVariants > 0 ? ' · 正在跑 ' + runningVariants + ' 个' : ''}
            </p>
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
          <p className="queue-panel__empty">队列是空的。选好变体后点「构建勾选项」或「构建当前项目」。</p>
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
          <ul className="queue-list">{visibleCurrent.map(renderItem)}</ul>
        )}

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
            {showOlder ? <ul className="queue-list queue-list--older">{visibleOlder.map(renderItem)}</ul> : null}
          </div>
        ) : null}

        {items.length >= QUEUE_LIST_LIMIT ? (
          <p className="queue-list__more tabular">
            只显示最近 {QUEUE_LIST_LIMIT} 条，更早的可以「清空队列记录」后重新入队
          </p>
        ) : null}
      </div>
    </section>
  )
}
