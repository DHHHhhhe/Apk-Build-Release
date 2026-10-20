import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { AppApi, Unsubscribe } from '@shared/types/api'
import type { BuildLogEvent, BuildProgressEvent, BuildStateEvent, SummaryScope } from '@shared/types/build'
import type { EnqueueTarget, QueueStateEvent } from '@shared/types/queue'
import type { UpdateState } from '@shared/types/update'

/** 事件订阅统一在这里收口：返回取消订阅函数，避免渲染进程拿到裸 ipcRenderer */
function subscribe<T>(channel: string, handler: (event: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T): void => {
    handler(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// 类型安全的桥：渲染进程只能通过 window.api 触达主进程（.trellis/spec/frontend/ipc-electron.md）
const api: AppApi = {
  env: {
    probe: (projectPath?: string) => ipcRenderer.invoke(IPC_CHANNELS.ENV.PROBE, { projectPath })
  },
  project: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT.LIST),
    add: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT.ADD, { path }),
    remove: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.PROJECT.REMOVE, { projectId }),
    refreshVariants: (projectId: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT.REFRESH_VARIANTS, { projectId, force }),
    setVariants: (projectId: string, variants: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT.SET_VARIANTS, { projectId, variants }),
    setAlias: (projectId: string, alias: string | null) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT.SET_ALIAS, { projectId, alias }),
    reorder: (projectIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT.REORDER, { projectIds }),
    pickDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.PROJECT.PICK_DIRECTORY),
    /** 入队前的廉价预检：只查文件系统，结果只用于提示 */
    preflight: (projectIds: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECT.PREFLIGHT, { projectIds })
  },
  queue: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.LIST),
    enqueue: (targets: EnqueueTarget[]) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.ENQUEUE, { targets }),
    setConcurrency: (limit: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUEUE.SET_CONCURRENCY, { limit }),
    cancel: (itemId: string) => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.CANCEL, { itemId }),
    cancelAll: () => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.CANCEL_ALL),
    retry: (itemId: string, variants?: string[]) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUEUE.RETRY, { itemId, variants }),
    clear: (scope: 'finished' | 'all') => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.CLEAR, { scope }),
    /** 恢复启动时暂停的队列（上次退出留下的 pending 项） */
    resume: () => ipcRenderer.invoke(IPC_CHANNELS.QUEUE.RESUME),
    onState: (handler: (event: QueueStateEvent) => void) =>
      subscribe(IPC_CHANNELS.QUEUE.STATE, handler)
  },
  build: {
    listRuns: (projectId: string, limit?: number) =>
      ipcRenderer.invoke(IPC_CHANNELS.BUILD.LIST_RUNS, { projectId, limit }),
    summary: (scope: SummaryScope, projectId?: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.BUILD.SUMMARY, { scope, projectId }),
    onLog: (handler: (event: BuildLogEvent) => void) => subscribe(IPC_CHANNELS.BUILD.LOG, handler),
    onState: (handler: (event: BuildStateEvent) => void) =>
      subscribe(IPC_CHANNELS.BUILD.STATE, handler),
    onProgress: (handler: (event: BuildProgressEvent) => void) =>
      subscribe(IPC_CHANNELS.BUILD.PROGRESS, handler)
  },
  app: {
    copyText: (text: string) => ipcRenderer.invoke(IPC_CHANNELS.APP.COPY_TEXT, text)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.GET),
    setOutputRoot: (path: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.SET_OUTPUT_ROOT, { path }),
    setTheme: (theme: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.SET_THEME, { theme }),
    setAutoCheckUpdate: (enabled: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.SET_AUTO_CHECK_UPDATE, { enabled }),
    pickOutputDir: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.PICK_OUTPUT_DIR),
    openPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.OPEN_PATH, { path }),
    clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.CLEAR_LOGS)
  },
  files: {
    // Electron 32 起 File 对象没有 path，只能在这里用 webUtils 换真实路径
    pathFor: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },
  update: {
    takeLaunchNotice: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE.TAKE_LAUNCH_NOTICE),
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE.GET_STATE),
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE.CHECK),
    download: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE.DOWNLOAD),
    install: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE.INSTALL),
    onState: (handler: (event: UpdateState) => void) => subscribe(IPC_CHANNELS.UPDATE.STATE, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
