import { useCallback, useEffect, useState } from 'react'
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
  /**
   * 还没落盘的勾选写入数量。
   * busyProjectId 只能表达「某一个项目在忙」，多个项目的勾选并发写入时会互相覆盖；
   * 构建入口要判断的是「有没有**任何**写入没落盘」，所以单独计数。
   */
  pendingWrites: number
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
  const [pendingWrites, setPendingWrites] = useState(0)
  const [reloadToken, setReloadToken] = useState(0)

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
    setLoading(true)

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
      setBusyProjectId(projectId)
      setBusyKind('variants')
      setPendingWrites((count) => count + 1)
      try {
        const result = await window.api.project.setVariants(projectId, variants)
        if (!result.success) {
          setError(result.error ?? '保存变体选择失败')
        } else {
          setError(result.error ?? null)
        }
        refresh()
      } finally {
        // 放在 finally：写入失败也必须归还计数，否则构建入口会永久卡在「保存中」
        setPendingWrites((count) => count - 1)
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
    pendingWrites,
    refresh,
    addProject,
    removeProject,
    refreshVariants,
    setVariants
  }
}
