import type {
  BuildListResult,
  BuildLogEvent,
  BuildRun,
  BuildStateEvent,
  BuildSummaryResult,
  SummaryScope
} from './build'
import type { EnvProbeResult } from './env'
import type { Project, ProjectListResult, ProjectResult } from './project'
import type {
  QueueItem,
  QueueListResult,
  QueueMutationResult,
  QueueStateEvent
} from './queue'
import type { BasicResult, SettingsResult } from './settings'

export interface PickDirectoryResult {
  success: boolean
  error?: string
  path: string | null
}

/** 取消订阅事件推送 */
export type Unsubscribe = () => void

// 渲染进程可见的 API 面：preload 实现它，渲染进程通过 window.api 使用它
export interface AppApi {
  env: {
    /** 探测本机构建环境；传入项目目录时会一并读取该项目的 local.properties 与 gradle-wrapper */
    probe: (projectPath?: string) => Promise<EnvProbeResult>
  }
  project: {
    list: () => Promise<ProjectListResult>
    add: (path: string) => Promise<ProjectResult>
    remove: (projectId: string) => Promise<{ success: boolean; error?: string }>
    refreshVariants: (projectId: string, force?: boolean) => Promise<ProjectResult>
    setVariants: (projectId: string, variants: string[]) => Promise<ProjectResult>
    pickDirectory: () => Promise<PickDirectoryResult>
  }
  queue: {
    list: () => Promise<QueueListResult>
    enqueue: (projectIds: string[]) => Promise<QueueMutationResult>
    setConcurrency: (limit: number) => Promise<QueueMutationResult>
    cancel: (itemId: string) => Promise<QueueMutationResult>
    cancelAll: () => Promise<QueueMutationResult>
    retry: (itemId: string) => Promise<QueueMutationResult>
    clear: (scope: 'finished' | 'all') => Promise<QueueMutationResult>
    onState: (handler: (event: QueueStateEvent) => void) => Unsubscribe
  }
  build: {
    listRuns: (projectId: string, limit?: number) => Promise<BuildListResult>
    summary: (scope: SummaryScope, projectId?: string) => Promise<BuildSummaryResult>
    onLog: (handler: (event: BuildLogEvent) => void) => Unsubscribe
    onState: (handler: (event: BuildStateEvent) => void) => Unsubscribe
  }
  app: {
    /** 复制文本；渲染层在 file:// 下没有 navigator.clipboard */
    copyText: (text: string) => Promise<BasicResult>
  }
  settings: {
    get: () => Promise<SettingsResult>
    setOutputRoot: (path: string) => Promise<SettingsResult>
    pickOutputDir: () => Promise<SettingsResult>
    openPath: (path: string) => Promise<BasicResult>
    clearLogs: () => Promise<BasicResult & { removed?: number; freedBytes?: number }>
  }
  files: {
    /** 拖拽进来的 File 对象换成真实磁盘路径；拿不到返回空串 */
    pathFor: (file: File) => string
  }
}

export type {
  BasicResult,
  BuildListResult,
  BuildLogEvent,
  BuildRun,
  BuildStateEvent,
  BuildSummaryResult,
  Project,
  ProjectListResult,
  ProjectResult,
  QueueItem,
  QueueListResult,
  QueueMutationResult,
  QueueStateEvent,
  SettingsResult,
  SummaryScope
}
