import { useEffect, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { X, RotateCcw, Trash2, FileText, FolderOpen } from 'lucide-react'
import { QUEUE_CONCURRENCY, QUEUE_LIST_LIMIT } from '@shared/constants/queue'
import type { QueueItem, QueueItemState, QueueRunDetail } from '@shared/types/queue'
import { useNow } from '../hooks/useNow'
import { formatDateTime, formatDurationMs } from '../lib/duration'

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

function stateBadgeClass(state: QueueItemState | QueueRunDetail['state']): string {
  if (state === 'success') {
    return 'badge badge--success'
  }
  if (state === 'failed') {
    return 'badge badge--destructive'
  }
  if (state === 'running') {
    return 'badge badge--info'
  }
  return 'badge badge--muted'
}

/** 每个变体自己的构建耗时：跑着的用 startedAt 现算，跑完用落库的 durationMs */
function runDurationText(run: QueueRunDetail, now: number): string {
  if (run.state === 'running' && run.startedAt !== null) {
    return `已用 ${formatDurationMs(Math.max(0, now - run.startedAt))}`
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

export function QueuePanel({
  items,
  concurrency,
  onCancel,
  onCancelAll,
  onRetry,
  onClear,
  onConcurrencyChange,
  onShowLog
}: {
  items: QueueItem[]
  concurrency: number
  onCancel: (itemId: string) => void
  onCancelAll: () => void
  onRetry: (itemId: string) => void
  onClear: (scope: 'finished' | 'all') => void
  onConcurrencyChange: (limit: number) => void
  /** 跳到某个项目的构建记录（看日志） */
  onShowLog: (projectId: string) => void
}): React.JSX.Element {
  const pending = items.filter((item) => item.state === 'pending')
  const running = items.filter((item) => item.state === 'running')
  const finished = items.filter((item) => item.state !== 'pending' && item.state !== 'running')
  const hasRunning = running.length > 0
  const now = useNow(hasRunning)

  // 取消请求发出后进程要过一会儿才退出，先本地标记「取消中」，别让用户以为没点上
  const [canceling, setCanceling] = useState<Set<string>>(new Set())

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
          <Badge variant="info" className="tabular">构建中 {running.length}</Badge>
          <Badge variant="muted" className="tabular">排队 {pending.length}</Badge>
          <label className="queue-panel__concurrency">
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
          <Button
             variant="ghost"
            disabled={pending.length + running.length === 0}
            onClick={() => {
              for (const item of [...running, ...pending]) {
                markCanceling(item.id)
              }
              onCancelAll()
            }}
          >
            <X size={14} aria-hidden="true" />
            全部取消
          </Button>
          <Button
            variant="ghost"
            disabled={finished.length === 0}
            onClick={() => {
              onClear('finished')
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            清空已结束
          </Button>
          <Button
            variant="ghost"
            disabled={items.length === 0}
            onClick={() => {
              onClear('all')
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            清空全部
          </Button>
        </header>

        {items.length === 0 ? (
          <p className="queue-panel__empty">队列是空的。选好变体后点右上角「加入队列并构建」。</p>
        ) : (
          <ul className="queue-list">
            {items.map((item) => {
              const isCanceling = canceling.has(item.id)
              const startedVariants = new Set(item.runs.map((run) => run.variant))
              const notStarted = item.variants.filter((variant) => !startedVariants.has(variant))
              const failedRun = item.runs.find((run) => run.state === 'failed')

              return (
                <li key={item.id} className="queue-list__item">
                  <div className="queue-list__row">
                    <span className="queue-list__project">{item.projectName}</span>
                    <span className={stateBadgeClass(item.state)}>
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
                          查看详情
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
                        <Button
                          variant="ghost"
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
                      {item.runs.slice(0, RUN_DETAIL_LIMIT).map((run) => (
                        <li key={run.variant} className="run-detail__item">
                          <span className="run-detail__variant tabular">{run.variant}</span>
                          <span className={stateBadgeClass(run.state)}>{RUN_STATE_LABEL[run.state]}</span>
                          {/* 三段计时分开给：这一项的总耗时在最上面那行，这里是这个变体的排队与构建 */}
                          <span className="run-detail__time tabular">
                            {run.startedAt !== null
                              ? `排队 ${formatDurationMs(Math.max(0, run.startedAt - item.enqueuedAt))} · `
                              : ''}
                            {runDurationText(run, now)}
                          </span>
                        </li>
                      ))}
                      {notStarted.map((variant) => (
                        <li key={variant} className="run-detail__item run-detail__item--todo">
                          <span className="run-detail__variant tabular">{variant}</span>
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

                  {/* 失败原因直接摆在这一行，不用切项目去找 */}
                  {failedRun?.failureHint ? (
                    <p className="queue-list__hint">
                      {failedRun.variant} 失败：{failedRun.failureHint}
                    </p>
                  ) : null}

                  {failedRun?.apkPath === null && failedRun?.logPath ? (
                    <p className="queue-list__path tabular">
                      <FolderOpen size={12} aria-hidden="true" />
                      {failedRun.logPath}
                    </p>
                  ) : null}

                  {item.note ? <p className="queue-list__note">{item.note}</p> : null}
                  {item.finishedAt ? (
                    <p className="queue-list__finished tabular">完成 {formatDateTime(item.finishedAt)}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {items.length >= QUEUE_LIST_LIMIT ? (
          <p className="queue-list__more tabular">
            只显示最近 {QUEUE_LIST_LIMIT} 条，更早的可以「清空已结束」后重新入队
          </p>
        ) : null}
      </div>
    </section>
  )
}
