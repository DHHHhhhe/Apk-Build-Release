// 队列的并发上限：主进程做校验与夹紧，渲染进程用它生成选项，两处必须同一份
export const QUEUE_CONCURRENCY = {
  MIN: 1,
  MAX: 3,
  /** 默认 1：先求稳，用户可以在队列面板显式调高 */
  DEFAULT: 1
} as const

/** 队列列表一次返回多少条；界面在被截断时会说明 */
export const QUEUE_LIST_LIMIT = 50
