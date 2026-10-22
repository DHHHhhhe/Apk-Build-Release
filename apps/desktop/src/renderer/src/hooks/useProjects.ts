import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types/project'

/** 正在进行的项目操作类型：界面据此显示对应按钮的「进行中」文案 */
export type ProjectBusyKind = 'add' | 'remove' | 'static' | 'gradle' | 'variants'

export interface UseProjectsResult {
  projects: Project[]
  loading: boolean
  error: string | null
  /** 正在执行操作的 project id，用于禁用该行按钮 */
  busyProjectId: string | null
  busyKind: ProjectBusyKind | null
  refresh: () => void
  /**
   * 按给定 id 顺序就地重排本地列表（乐观更新）。
   *
   * 拖动排序松手时必须先调它：否则「清掉拖拽态」与「请求返回后重新拉取」之间
   * 会有一段时间列表仍是旧顺序，卡片会先弹回原位、再跳到新位置 —— 就是用户看到的闪烁。
   */
  reorderLocally: (ids: string[]) => void
  addProject: (path: string) => Promise<string | null>
  removeProject: (projectId: string) => Promise<void>
  refreshVariants: (projectId: string, force?: boolean) => Promise<void>
  setVariants: (projectId: string, variants: string[]) => Promise<void>
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<ProjectBusyKind | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  /** 首次读取还没完成（此后 refresh 不再退回加载态，见下面 effect 的注释） */
  const loadingRef = useRef(true)

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const reorderLocally = useCallback((ids: string[]) => {
    setProjects((previous) => {
      const byId = new Map(previous.map((project) => [project.id, project]))
      const next: Project[] = []
      for (const id of ids) {
        const found = byId.get(id)
        if (found !== undefined) {
          next.push(found)
          byId.delete(id)
        }
      }
      // ids 里没出现的（理论上不会有）按原有相对顺序接在后面，避免丢项
      for (const project of previous) {
        if (byId.has(project.id)) {
          next.push(project)
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    /*
     * 只有**首次**读取才置 loading。
     *
     * refresh() 每次都会把 reloadToken 加一再走这里，而 loading 会直接换掉顶栏左上角的文案
     * （「6 个项目」→「读取项目…」）—— 勾一下变体就会闪一下，就是这么来的。
     * 后续刷新时列表还是旧数据、也照样能读，没必要退回加载态。
     */
    if (loadingRef.current) {
      setLoading(true)
    }

    void window.api.project
      .list()
      .then((result) => {
        if (cancelled) {
          return
        }
        if (!result.success) {
          setError(result.error ?? '读取项目列表失败')
          return
        }
        setError(null)
        setProjects(result.projects)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取项目列表失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          loadingRef.current = false
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const addProject = useCallback(
    async (path: string): Promise<string | null> => {
      setBusyProjectId('__add__')
      setBusyKind('add')
      try {
        const result = await window.api.project.add(path)
        if (!result.success) {
          setError(result.error ?? '添加项目失败')
          return result.error ?? '添加项目失败'
        }
        setError(null)
        refresh()
        return null
      } catch (caught: unknown) {
        const message = caught instanceof Error ? caught.message : '添加项目失败'
        setError(message)
        return message
      } finally {
        setBusyProjectId(null)
        setBusyKind(null)
      }
    },
    [refresh]
  )

  const removeProject = useCallback(
    async (projectId: string): Promise<void> => {
      setBusyProjectId(projectId)
      setBusyKind('remove')
      try {
        const result = await window.api.project.remove(projectId)
        if (!result.success) {
          setError(result.error ?? '移除项目失败')
          return
        }
        setError(null)
        refresh()
      } finally {
        setBusyProjectId(null)
        setBusyKind(null)
      }
    },
    [refresh]
  )

  const refreshVariants = useCallback(
    async (projectId: string, force?: boolean): Promise<void> => {
      setBusyProjectId(projectId)
      setBusyKind(force === true ? 'gradle' : 'static')
      try {
        const result = await window.api.project.refreshVariants(projectId, force)
        if (!result.success) {
          setError(result.error ?? '刷新变体失败')
        } else {
          setError(null)
        }
        refresh()
      } finally {
        setBusyProjectId(null)
        setBusyKind(null)
      }
    },
    [refresh]
  )

  const setVariants = useCallback(
    async (projectId: string, variants: string[]): Promise<void> => {
      /*
       * 乐观更新：勾选框立刻翻转，不等写库往返。
       * 以前只有写回后才 refresh，于是每次勾选都要等一次往返才变色 —— 手快的时候
       * 看起来像「点了没反应，然后又闪一下」。
       * 失败时 finally 之后仍会 refresh，用主进程的真值把界面纠正回来。
       */
      setProjects((previous) =>
        previous.map((project) =>
          project.id === projectId ? { ...project, selectedVariants: variants } : project
        )
      )
      setBusyProjectId(projectId)
      setBusyKind('variants')
      try {
        const result = await window.api.project.setVariants(projectId, variants)
        if (!result.success) {
          setError(result.error ?? '保存变体选择失败')
        } else {
          setError(result.error ?? null)
        }
        refresh()
      } finally {
        setBusyProjectId(null)
        setBusyKind(null)
      }
    },
    [refresh]
  )

  return {
    projects,
    reorderLocally,
    loading,
    error,
    busyProjectId,
    busyKind,
    refresh,
    addProject,
    removeProject,
    refreshVariants,
    setVariants
  }
}
