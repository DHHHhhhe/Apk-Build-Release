import { useCallback, useEffect, useState } from 'react'
import type { EnqueueTarget, QueueItem } from '@shared/types/queue'

export interface UseQueueResult {
  items: QueueItem[]
  concurrency: number
  loading: boolean
  error: string | null
  enqueue: (targets: EnqueueTarget[]) => Promise<void>
  setConcurrency: (limit: number) => Promise<void>
  cancel: (itemId: string) => Promise<void>
  cancelAll: () => Promise<void>
  retry: (itemId: string) => Promise<void>
  clear: (scope: 'finished' | 'all') => Promise<void>
  refresh: () => void
}

export function useQueue(): UseQueueResult {
  const [items, setItems] = useState<QueueItem[]>([])
  const [concurrency, setConcurrencyState] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void window.api.queue
      .list()
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.success) {
          setError(result.error ?? '读取队列失败')
          return
        }
        setError(null)
        setItems(result.items)
        setConcurrencyState(result.concurrency)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取队列失败')
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
  }, [reloadToken])

  // 队列项状态由主进程推过来，界面不轮询
  useEffect(() => {
    return window.api.queue.onState((event) => {
      setItems((previous) => {
        const withoutCurrent = previous.filter((item) => item.id !== event.item.id)
        return [event.item, ...withoutCurrent].sort((left, right) => right.enqueuedAt - left.enqueuedAt)
      })
    })
  }, [])

  const runMutation = useCallback(
    async (operation: () => Promise<{ success: boolean; error?: string; items?: QueueItem[] }>) => {
      try {
        const result = await operation()
        if (!result.success) {
          setError(result.error ?? '操作失败')
          return
        }
        setError(result.error ?? null)
        if (result.items) {
          setItems(result.items)
        }
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : '操作失败')
      }
    },
    []
  )

  const enqueue = useCallback(
    (targets: EnqueueTarget[]) => runMutation(() => window.api.queue.enqueue(targets)),
    [runMutation]
  )

  const setConcurrency = useCallback(
    (limit: number) =>
      runMutation(async () => {
        const result = await window.api.queue.setConcurrency(limit)
        if (result.success) {
          setConcurrencyState(limit)
        }
        return result
      }),
    [runMutation]
  )

  const cancel = useCallback(
    (itemId: string) => runMutation(() => window.api.queue.cancel(itemId)),
    [runMutation]
  )

  const cancelAll = useCallback(
    () => runMutation(() => window.api.queue.cancelAll()),
    [runMutation]
  )

  const retry = useCallback(
    (itemId: string) => runMutation(() => window.api.queue.retry(itemId)),
    [runMutation]
  )

  const clear = useCallback(
    (scope: 'finished' | 'all') => runMutation(() => window.api.queue.clear(scope)),
    [runMutation]
  )

  return {
    items,
    concurrency,
    loading,
    error,
    enqueue,
    setConcurrency,
    cancel,
    cancelAll,
    retry,
    clear,
    refresh
  }
}
