import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnqueueTarget, QueueItem } from '@shared/types/queue'
import { mergeQueueItems, isStaleResponse } from '../lib/queue-merge'
import { sortQueueItems } from '@shared/lib/queue-order'

export interface UseQueueResult {
  items: QueueItem[]
  concurrency: number
  /** 队列停在暂停态（启动时有上次没跑的项），要用户点「继续上次队列」 */
  paused: boolean
  loading: boolean
  error: string | null
  enqueue: (targets: EnqueueTarget[]) => Promise<void>
  setConcurrency: (limit: number) => Promise<void>
  cancel: (itemId: string) => Promise<void>
  cancelAll: () => Promise<void>
  /** 重试；给出 variants 时只重跑这些变体 */
  retry: (itemId: string, variants?: string[]) => Promise<void>
  clear: (scope: 'finished' | 'all') => Promise<void>
  resume: () => Promise<void>
  refresh: () => void
}

export function useQueue(): UseQueueResult {
  const [items, setItems] = useState<QueueItem[]>([])
  const [concurrency, setConcurrencyState] = useState(1)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  /**
   * 请求序号。
   *
   * 连续操作（先构建一批、没跑完再构建一批）会同时有多个请求在飞，响应可能乱序回来：
   * 后发的先回、先发的后回。先发的那份带的是更旧的快照，无条件 setItems 就会把
   * 刚入队、正在构建的那一项抹掉 —— 症状是「项目在构建，队列里却没有它，
   * 侧栏也没有队列徽章」，而且不会自己恢复，直到那一项下次状态变化。
   */
  const requestSeq = useRef(0)
  const appliedSeq = useRef(0)

  useEffect(() => {
    let cancelled = false
    const seq = (requestSeq.current += 1)
    setLoading(true)

    void window.api.queue
      .list()
      .then((result) => {
        if (cancelled || isStaleResponse(seq, appliedSeq.current)) {
          return
        }
        appliedSeq.current = seq
        if (!result.success) {
          setError(result.error ?? '读取队列失败')
          return
        }
        setError(null)
        // 客户端自己排一次：不依赖服务端的返回顺序，规则与事件推送、合并走同一份
        setItems(sortQueueItems(result.items))
        setConcurrencyState(result.concurrency)
        setPaused(result.paused)
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

  // 事件序号：用来判断「变更响应回来时，这一项是不是已经被更新的推送覆盖过」
  const eventSeq = useRef(0)
  const eventSeqById = useRef(new Map<string, number>())

  // 队列项状态由主进程推过来，界面不轮询
  useEffect(() => {
    return window.api.queue.onState((event) => {
      eventSeq.current += 1
      eventSeqById.current.set(event.item.id, eventSeq.current)
      setItems((previous) => {
        const withoutCurrent = previous.filter((item) => item.id !== event.item.id)
        return sortQueueItems([event.item, ...withoutCurrent])
      })
    })
  }, [])

  const runMutation = useCallback(
    async (operation: () => Promise<{ success: boolean; error?: string; items?: QueueItem[] }>) => {
      // 记下请求发出时的序号：响应回来后，只对「这期间没被事件更新过」的项采用响应里的版本
      const seqAtRequest = eventSeq.current
      const reqSeq = (requestSeq.current += 1)
      try {
        const result = await operation()
        // 乱序回来的旧响应：数据丢掉，但失败照说，别把「其实没成功」瞒过去
        if (isStaleResponse(reqSeq, appliedSeq.current)) {
          if (!result.success) {
            setError(result.error ?? '操作失败')
          }
          return
        }
        appliedSeq.current = reqSeq
        if (!result.success) {
          setError(result.error ?? '操作失败')
          return
        }
        setError(result.error ?? null)
        if (result.items) {
          const incoming = result.items
          const staleIds = new Set(
            [...eventSeqById.current.entries()]
              .filter(([, seq]) => seq > seqAtRequest)
              .map(([id]) => id)
          )
          setItems((previous) => mergeQueueItems(previous, incoming, staleIds))
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
    (itemId: string, variants?: string[]) =>
      runMutation(() => window.api.queue.retry(itemId, variants)),
    [runMutation]
  )

  const clear = useCallback(
    (scope: 'finished' | 'all') => runMutation(() => window.api.queue.clear(scope)),
    [runMutation]
  )

  /** 继续上次队列：恢复调度后重新读一次，paused 会跟着变成 false */
  const resume = useCallback(async (): Promise<void> => {
    try {
      const reqSeq = (requestSeq.current += 1)
      const result = await window.api.queue.resume()
      // 与其它队列请求共用序号：恢复队列的响应也不能把更晚到的状态盖回去
      if (reqSeq < appliedSeq.current) {
        return
      }
      appliedSeq.current = reqSeq
      if (!result.success) {
        setError(result.error ?? '恢复队列失败')
        return
      }
      setError(null)
      setItems(sortQueueItems(result.items))
      setConcurrencyState(result.concurrency)
      setPaused(result.paused)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '恢复队列失败')
    }
  }, [])

  return {
    items,
    concurrency,
    paused,
    loading,
    error,
    enqueue,
    setConcurrency,
    cancel,
    cancelAll,
    retry,
    clear,
    resume,
    refresh
  }
}
