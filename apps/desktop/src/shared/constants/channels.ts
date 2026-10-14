// IPC 频道常量：主进程与 preload 共用，禁止在业务代码里写裸字符串
export const IPC_CHANNELS = {
  ENV: {
    PROBE: 'env:probe'
  },
  PROJECT: {
    ADD: 'project:add',
    LIST: 'project:list',
    REMOVE: 'project:remove',
    REFRESH_VARIANTS: 'project:refreshVariants',
    SET_VARIANTS: 'project:setVariants',
    PICK_DIRECTORY: 'project:pickDirectory'
  },
  QUEUE: {
    ENQUEUE: 'queue:enqueue',
    LIST: 'queue:list',
    SET_CONCURRENCY: 'queue:setConcurrency',
    CANCEL: 'queue:cancel',
    CANCEL_ALL: 'queue:cancelAll',
    RETRY: 'queue:retry',
    CLEAR: 'queue:clear',
    /** 队列项状态变化的事件推送 */
    STATE: 'queue:state'
  },
  BUILD: {
    LIST_RUNS: 'build:listRuns',
    SUMMARY: 'build:summary',
    LOG: 'build:log',
    STATE: 'build:state'
  },
  APP: {
    /** 渲染层在 file:// 下拿不到 navigator.clipboard，走主进程 */
    COPY_TEXT: 'app:copyText'
  },
  SETTINGS: {
    GET: 'settings:get',
    SET_OUTPUT_ROOT: 'settings:setOutputRoot',
    SET_THEME: 'settings:setTheme',
    SET_AUTO_CHECK_UPDATE: 'settings:setAutoCheckUpdate',
    PICK_OUTPUT_DIR: 'settings:pickOutputDir',
    OPEN_PATH: 'settings:openPath',
    CLEAR_LOGS: 'settings:clearLogs'
  },
  UPDATE: {
    TAKE_LAUNCH_NOTICE: 'update:takeLaunchNotice',
    GET_STATE: 'update:getState',
    CHECK: 'update:check',
    DOWNLOAD: 'update:download',
    INSTALL: 'update:install',
    /** 更新状态变化的事件推送 */
    STATE: 'update:state'
  }
} as const
