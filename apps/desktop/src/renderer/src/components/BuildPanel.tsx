import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ArrowDown, FolderOpen, FileText, Search } from 'lucide-react'
import type { BuildRun } from '@shared/types/build'
import { useNow } from '../hooks/useNow'
import { elapsedMs, formatClock, formatDurationMs } from '../lib/duration'
import { dirnameOf } from '../lib/path-display'
import { openPathOrToast } from '../lib/open-path'
import { buildStateBadgeClass } from '../lib/state-badge'

const STATE_LABEL: Record<BuildRun['state'], string> = {
  running: '构建中',
  success: '成功',
  failed: '失败',
  canceled: '已取消'
}

/** 日志最多渲染这么多行，再多只显示尾部（几千行全渲染会卡） */
const LOG_RENDER_LIMIT = 2000
const ERROR_LINE = /error|failed|failure|exception|caused by|FAILURE:|not found/i



/** 跑着的显示已用时间，跑完显示完成时刻 + 该变体的构建耗时 */
function runTimeText(run: BuildRun, now: number): string {
  const elapsed = formatDurationMs(elapsedMs(run, now))
  if (run.state === 'running') {
    return `已用 ${elapsed}`
  }
  const finishedAt = run.finishedAt ?? run.startedAt
  return `完成 ${formatClock(finishedAt)} · 耗时 ${elapsed}`
}

/** 成功的 run 也可能带提示（未签名、没定位到 APK），用警告色而不是错误色 */
function hintClass(run: BuildRun): string {
  if (run.state === 'failed' || run.state === 'canceled') {
    return 'run-list__hint run-list__hint--error'
  }
  return 'run-list__hint run-list__hint--warning'
}

/**
 * 日志区的空态说清是哪一种「空」。
 *
 * 以前三种情况共用一句「（还没有输出）」，于是重启后回看历史构建，看起来像构建真的没有输出 ——
 * 其实日志只在本会话收到过 build:log 事件，历史记录的正文在日志文件里。
 */
function emptyLogText(run: BuildRun): string {
  if (run.state === 'running') {
    return '（还在跑，暂时没有输出）'
  }
  if (run.logPath) {
    return '（本会话没有收到这一条的输出，完整日志在日志文件里）'
  }
  return '（这一条没有输出）'
}

export function BuildPanel({
  runs,
  logs,
  activeRunId,
  building,
  hasMore,
  onLoadMore
}: {
  runs: BuildRun[]
  logs: Record<string, string>
  activeRunId: string | null
  building: boolean
  hasMore: boolean
  onLoadMore: () => void
}): React.JSX.Element {
  const logRef = useRef<HTMLPreElement | null>(null)
  const [follow, setFollow] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  /**
   * 手动点选的那一条。
   *
   * 以前日志区只能看 `activeRunId ?? runs[0]`：正在跑的时候还好，跑完想看另一条
   * 就得去队列里找。选中的 run 被删掉（清空队列）时回退到默认那条。
   */
  const [pickedRunId, setPickedRunId] = useState<string | null>(null)

  const pickedRun = pickedRunId === null ? null : (runs.find((run) => run.id === pickedRunId) ?? null)
  const activeRun = pickedRun ?? runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null
  const activeLog = activeRun ? (logs[activeRun.id] ?? '') : ''
  const now = useNow(runs.some((run) => run.state === 'running'))

  const logLines = useMemo(() => {
    if (activeLog === '') {
      return []
    }
    const lines = activeLog.split(/\r?\n/)
    const trimmed = lines.length > LOG_RENDER_LIMIT ? lines.slice(-LOG_RENDER_LIMIT) : lines
    const needle = keyword.trim().toLowerCase()
    if (needle === '' && !errorsOnly) {
      return trimmed
    }
    return trimmed.filter((line) => {
      if (errorsOnly && !ERROR_LINE.test(line)) {
        return false
      }
      return needle === '' || line.toLowerCase().includes(needle)
    })
  }, [activeLog, keyword, errorsOnly])

  const filtered = keyword.trim() !== '' || errorsOnly

  // 只有贴着底部时才自动跟随；用户往上翻就停下，并给出「有新日志」提示
  useEffect(() => {
    const node = logRef.current
    if (!node || !follow || filtered) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [activeLog, follow, filtered])

  const handleScroll = (): void => {
    const node = logRef.current
    if (!node) {
      return
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    setFollow(distance < 40)
  }

  return (
    <section className="card-shell">
      <div className="card-core card-core--pad build-panel">
        <header className="build-panel__head">
          <h3 className="build-panel__title">构建记录</h3>
          {building ? <Badge variant="info">构建中</Badge> : null}
          {activeRun ? (
            <span className={buildStateBadgeClass(activeRun.state)}>{STATE_LABEL[activeRun.state]}</span>
          ) : null}
        </header>

        {runs.length === 0 ? (
          <p className="build-panel__empty">还没有构建记录。选好变体后点右上角「加入队列并构建」。</p>
        ) : (
          <ul className="run-list">
            {runs.map((run) => (
              <li key={run.id} className="run-list__item">
                <div className="run-list__row">
                  {/* 变体名就是「看这一条日志」的入口：比另加一个按钮省一行，也不会让行内挤满控件 */}
                  <button
                    type="button"
                    className={
                      run.id === activeRun?.id
                        ? 'run-list__variant run-list__variant--active'
                        : 'run-list__variant'
                    }
                    aria-pressed={run.id === activeRun?.id}
                    title={`查看 ${run.variant} 的日志`}
                    onClick={() => {
                      setPickedRunId(run.id)
                    }}
                  >
                    {run.variant}
                  </button>
                  <span className={buildStateBadgeClass(run.state)}>{STATE_LABEL[run.state]}</span>
                  <span className="run-list__time tabular" title={new Date(run.startedAt).toLocaleString()}>
                    {runTimeText(run, now)}
                  </span>
                  {run.exitCode !== null && run.state !== 'success' ? (
                    <span className="run-list__exit tabular">exit {run.exitCode}</span>
                  ) : null}
                  {run.logPath ? (
                    <Button
                      variant="ghost"
                      title={run.logPath}
                      onClick={() => {
                        void openPathOrToast(run.logPath ?? '', '日志文件')
                      }}
                    >
                      <FileText size={14} aria-hidden="true" />
                      日志文件
                    </Button>
                  ) : null}
                </div>

                {run.apkName ? (
                  <p className="run-list__apk tabular">
                    <Button
                      variant="ghost"
                      className="run-list__open"
                      title="打开产物所在目录"
                      onClick={() => {
                        void openPathOrToast(dirnameOf(run.apkPath ?? ''), '产物目录')
                      }}
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                    </Button>
                    <span className="run-list__apk-name" title={run.apkPath ?? run.apkName}>
                      {run.apkName}
                    </span>
                    {run.signed === false ? (
                      <Badge variant="warning">未签名，不可直接安装</Badge>
                    ) : run.signed === true ? (
                      <Badge variant="success">已签名</Badge>
                    ) : (
                      <Badge variant="muted">签名未验证</Badge>
                    )}
                  </p>
                ) : null}

                {run.applicationId || run.versionName ? (
                  <p className="run-list__meta tabular">
                    {run.applicationId ?? ''}
                    {run.versionName ? ` · v${run.versionName}` : ''}
                    {run.versionCode !== null ? ` (${run.versionCode})` : ''}
                  </p>
                ) : null}

                {run.failureHint ? <p className={hintClass(run)}>{run.failureHint}</p> : null}
                {run.apkPath ? <p className="run-list__path tabular">{run.apkPath}</p> : null}
              </li>
            ))}
          </ul>
        )}

        {hasMore ? (
          <Button variant="ghost" className="build-panel__more" onClick={onLoadMore}>
            加载更早的构建记录
          </Button>
        ) : null}

        {activeRun ? (
          <div className="build-panel__log-wrap" data-drawer-section="log">
            <div className="build-panel__log-head">
              <span className="build-panel__log-label">日志 · {activeRun.variant}</span>
              <label className="build-panel__log-filter">
                <Search size={14} aria-hidden="true" />
                <input
                  className="input build-panel__log-input"
                  value={keyword}
                  placeholder="过滤关键字"
                  onChange={(event) => {
                    setKeyword(event.target.value)
                  }}
                  aria-label="过滤日志关键字"
                />
              </label>
              <label className="build-panel__log-toggle">
                <input
                  type="checkbox"
                  checked={errorsOnly}
                  onChange={(event) => {
                    setErrorsOnly(event.target.checked)
                  }}
                />
                只看报错
              </label>
              {filtered ? (
                <span className="build-panel__log-count tabular">{logLines.length} 行匹配</span>
              ) : null}
              {activeLog === '' && activeRun.logPath ? (
                <Button
                  variant="ghost"
                  title={activeRun.logPath}
                  onClick={() => {
                    void openPathOrToast(activeRun.logPath ?? '', '日志文件')
                  }}
                >
                  <FileText size={14} aria-hidden="true" />
                  打开日志文件
                </Button>
              ) : null}
            </div>

            <div className="build-panel__log-body">
              <pre className="build-panel__log" ref={logRef} onScroll={handleScroll} role="log" aria-live="polite">
                {logLines.length === 0
                  ? activeLog === ''
                    ? emptyLogText(activeRun)
                    : '（没有匹配的行）'
                  : logLines.map((line, index) => (
                      <span
                        key={`${index}-${line.slice(0, 12)}`}
                        className={ERROR_LINE.test(line) ? 'build-panel__log-line build-panel__log-line--error' : 'build-panel__log-line'}
                      >
                        {line}
                        {'\n'}
                      </span>
                    ))}
              </pre>
              {!follow && !filtered ? (
                <Button
                  variant="outline"
                  className="build-panel__log-jump"
                  onClick={() => {
                    setFollow(true)
                    const node = logRef.current
                    if (node) {
                      node.scrollTop = node.scrollHeight
                    }
                  }}
                >
                  <ArrowDown size={14} aria-hidden="true" />
                  有新日志
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
