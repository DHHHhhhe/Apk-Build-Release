import { logger as baseLogger } from './services/logger'

const logger = baseLogger.scope('single-instance')

/**
 * 只用到的那几个 app 成员。
 *
 * 抽成接口是为了能单测「锁没拿到就退出」这条分支 —— 直接 mock 整个 electron.app
 * 会把测试绑在 Electron 内部实现上。
 */
export interface SingleInstanceHost {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: (...args: unknown[]) => void): unknown
}

/**
 * 抢单实例锁。
 *
 * 返回 false 表示本次启动不该继续：同一个 userData 下已经有实例在跑
 * （Electron 的锁就是 userData 下的 SingletonLock），此时第二个进程必须
 * 在建窗口、开数据库、收尾队列之前退出 —— 两个进程同时写同一个 SQLite，
 * 并且各自会把对方正在跑的队列项判成「上次残留」。
 *
 * 锁在的情况下注册 second-instance：用户再点一次图标时，由已有实例把窗口叫到前面。
 * 这个事件 Electron 保证在 ready 之后才发出，所以在回调里建窗口是安全的。
 */
export function acquireSingleInstance(host: SingleInstanceHost, onSecondInstance: () => void): boolean {
  if (!host.requestSingleInstanceLock()) {
    logger.info('已有实例在运行，本次启动直接退出')
    host.quit()
    return false
  }
  host.on('second-instance', () => {
    logger.info('检测到重复启动，聚焦已有窗口')
    onSecondInstance()
  })
  return true
}

/** 窗口里用到的那几项，抽出来是为了能单测「不新建窗口」这条约束 */
export interface WindowLike {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * 重复启动时把已有窗口叫到前面。
 *
 * **只唤醒，不新建**：两个界面同时读写同一份队列和数据库，比看不到窗口糟得多。
 * 只有在窗口全关、进程还活着时（macOS 上点红色叉就是这种状态）才重新开一个 ——
 * 那种情况下确实没有窗口可聚焦，用户点图标就是想看到界面。
 */
export function focusOrCreate(windows: WindowLike[], create: () => void): void {
  const [win] = windows
  if (!win) {
    create()
    return
  }
  // 最小化的窗口 show() 不会把它还原，必须先 restore
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}