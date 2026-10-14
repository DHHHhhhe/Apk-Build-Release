import { useCallback, useEffect, useState } from 'react'
import type { EnvProbeResult } from '@shared/types/env'

export interface UseEnvProbeResult {
  result: EnvProbeResult | null
  loading: boolean
  error: string | null
  refresh: () => void
}

/** 环境自检：projectPath 变化或手动刷新时重新探测 */
export function useEnvProbe(projectPath: string): UseEnvProbeResult {
  const [result, setResult] = useState<EnvProbeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const path = projectPath.trim()
    const request = path === '' ? window.api.env.probe() : window.api.env.probe(path)

    void request
      .then((probed) => {
        if (cancelled) {
          return
        }
        if (!probed.success) {
          setError(probed.error ?? '环境探测失败')
          setResult(null)
          return
        }
        setResult(probed)
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return
        }
        setError(caught instanceof Error ? caught.message : '环境探测失败')
        setResult(null)
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, reloadToken])

  return { result, loading, error, refresh }
}
