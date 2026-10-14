import { useCallback, useEffect, useState } from 'react'
import type { BuildSummary, SummaryScope } from '@shared/types/build'

export interface UseBuildSummaryResult {
  summary: BuildSummary | null
  scope: SummaryScope
  loading: boolean
  error: string | null
  setScope: (scope: SummaryScope) => void
  refresh: () => void
}

/**
 * 结果汇总（跨项目）。构建状态变化（build:state）后自动重取，所以队列跑完不用手点刷新。
 */
export function useBuildSummary(): UseBuildSummaryResult {
  const [summary, setSummary] = useState<BuildSummary | null>(null)
  const [scope, setScope] = useState<SummaryScope>('latest')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void window.api.build
      .summary(scope)
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.success) {
          setError(result.error ?? '读取结果汇总失败')
          return
        }
        setError(null)
        setSummary(result.summary)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取结果汇总失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [scope, reloadToken])

  // 有 run 结束时重取一次，汇总里的数字跟着动
  useEffect(() => {
    return window.api.build.onState((event) => {
      if (event.state !== 'running') {
        refresh()
      }
    })
  }, [refresh])

  return { summary, scope, loading, error, setScope, refresh }
}
