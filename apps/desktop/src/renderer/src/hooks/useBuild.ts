import { useCallback, useEffect, useRef, useState } from 'react'
import type { BuildRun } from '@shared/types/build'

/**
 * 单个 run 的日志上限，避免长构建把渲染进程内存吃满。
 *
 * 从 20 万提到 100 万字符：20 万只够 700 行左右，真实构建（R8 警告刷屏）里
 * 「过滤关键字」常常一行都命中不了，因为命中的那几行早被挤出窗口了。
 * 100 万约 4000~5000 行，仍然只是「阅读用的窗口」，完整日志始终在日志文件里。
 */
const LOG_LIMIT_PER_RUN = 1_000_000

/** 构建记录一次取多少条；不够时界面可以「加载更多」 */
export const RUN_PAGE_SIZE = 20

export interface UseBuildResult {
  runs: BuildRun[]
  logs: Record<string, string>
  activeRunId: string | null
  error: string | null
  /** 记录条数已经到上限，可能还有更早的 */
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
}

/**
 * 某个项目的构建记录与日志。
 * 构建由队列驱动（queue 域负责入队与调度），这里只订阅结果事件。
 */
export function useBuild(projectId: string | null): UseBuildResult {
  const [runs, setRuns] = useState<BuildRun[]>([])
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(RUN_PAGE_SIZE)
  const [reloadToken, setReloadToken] = useState(0)
  const projectIdRef = useRef<string | null>(projectId)

  projectIdRef.current = projectId

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    setLimit((current) => current + RUN_PAGE_SIZE)
  }, [])

  // 换项目时把分页退回第一页，否则新项目会继承上一个项目的条数
  useEffect(() => {
    setLimit(RUN_PAGE_SIZE)
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setRuns([])
      return
    }
    let cancelled = false

    void window.api.build
      .listRuns(projectId, limit)
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.success) {
          setError(result.error ?? '读取构建记录失败')
          return
        }
        setError(null)
        setRuns(result.runs)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取构建记录失败')
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectId, limit, reloadToken])

  useEffect(() => {
    // 日志按 runId 全量收：切走项目期间另一条构建的日志也不丢，切回来还在
    const unsubscribeLog = window.api.build.onLog((event) => {
      setLogs((previous) => {
        const merged = (previous[event.runId] ?? '') + event.chunk
        return {
          ...previous,
          [event.runId]: merged.length > LOG_LIMIT_PER_RUN ? merged.slice(-LOG_LIMIT_PER_RUN) : merged
        }
      })
      if (event.projectId === projectIdRef.current) {
        setActiveRunId(event.runId)
      }
    })

    const unsubscribeState = window.api.build.onState((event) => {
      if (event.projectId !== projectIdRef.current) {
        return
      }
      setRuns((previous) => {
        const withoutCurrent = previous.filter((run) => run.id !== event.runId)
        return [event.run, ...withoutCurrent].sort((left, right) => right.startedAt - left.startedAt)
      })
      if (event.state !== 'running') {
        setActiveRunId((current) => (current === event.runId ? null : current))
      } else {
        setActiveRunId(event.runId)
      }
    })

    return () => {
      unsubscribeLog()
      unsubscribeState()
    }
  }, [])

  return { runs, logs, activeRunId, error, hasMore: runs.length >= limit, loadMore, refresh }
}
