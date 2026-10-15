import { app } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { UpdateState } from '@shared/types/update'
import { logger as baseLogger } from '../logger'
import { getAutoCheckUpdate } from '../build/lib/settings'
import { broadcast } from '../../lib/broadcast'

const logger = baseLogger.scope('update')

/** electron-updater 的 AppUpdater。用类型引用，避免顶层 import 把加载失败拖到启动期 */
type AutoUpdater = import('electron-updater').AppUpdater

/**
 * 启动后隔多久查一次更新。
 *
 * 查更新要联网，刚启动时正忙着建窗口、读配置、探测构建环境，别在这时候抢带宽；
 * 而且装好新版本之后用户一般也不会马上重启，晚几分钟发现完全够用。
 */
const STARTUP_CHECK_DELAY_MS = 15_000

let updater: AutoUpdater | null = null
let loaded = false

/**
 * 便携版没有安装目录，装更新只会多出一份副本，所以它一律没有自动更新。
 *
 * 判据用 electron-builder 给便携版设的环境变量（`PORTABLE_EXECUTABLE_DIR`）——
 * 那是官方文档里判断「当前跑的是不是便携版」的方式。导出是为了能单测：
 * 便携版永远查不到更新，这是用户可见行为，值得有测试守着。
 */
export function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR)
}

function createInitialState(): UpdateState {
  return {
    phase: 'idle',
    currentVersion: app.getVersion(),
    version: '',
    percent: 0,
    message: '',
    releaseNotes: '',
    manual: false,
    // 开发态为 true：先让入口可见，点下去会明确说「这个形态没有自动更新」
    canUpdate: !app.isPackaged || !isPortableBuild()
  }
}

let state: UpdateState = createInitialState()

function patch(next: Partial<UpdateState>): void {
  state = { ...state, ...next }
  // 用共享的广播：遍历窗口、跳过已销毁的那段逻辑只留一份（lib/broadcast）
  broadcast(IPC_CHANNELS.UPDATE.STATE, state)
}

/**
 * 把 electron-updater 的报错翻成人能看懂的一句话 —— 原始信息里全是 URL 与堆栈。
 *
 * 最常见的那一条是「更新服务器上找不到这个版本的信息」：地址写错、或者 Release
 * 还是草稿。这句必须准确，否则用户只会看到一串英文堆栈。
 */
function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo/i.test(raw)) {
    return '连不上更新服务器，检查一下网络。'
  }
  // electron 的网络栈不走 Node 的 errno，域名解析不了时报的是 ERR_NAME_NOT_RESOLVED 这类名字
  if (
    /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|ERR_ADDRESS_UNREACHABLE|ERR_EMPTY_RESPONSE/i.test(
      raw
    )
  ) {
    return '连不上更新服务器，检查一下网络。'
  }
  if (/Unable to find latest version on GitHub|Cannot parse releases feed|releases\/latest/i.test(raw)) {
    return '这个包里的更新地址不对（或 Release 还没发布），只能重新下载安装包。'
  }
  if (/\b403\b/.test(raw)) {
    return 'GitHub 拒绝了这次请求（403），多半是同一网络里查得太频繁，过一会儿再试。'
  }
  if (/\b404\b/.test(raw)) {
    return '更新服务器上找不到这个版本的信息，可能还没发布新版本。'
  }
  return `检查更新失败：${raw.split('\n')[0]}`
}

/** release notes 在 electron-updater 里的形状：一个字符串，或者按版本分的数组 */
type ReleaseNotes = import('electron-updater').UpdateInfo['releaseNotes']

/** 统一成一段文本；拿不到就当空串，界面据此不显示「更新内容」那一块 */
function normalizeReleaseNotes(notes: ReleaseNotes): string {
  if (notes == null) {
    return ''
  }
  if (typeof notes === 'string') {
    return notes
  }
  return notes
    .map((item) => (item.note ?? '').trim())
    .filter((note) => note !== '')
    .join('\n\n')
}

/**
 * 惰性加载 electron-updater。
 *
 * 不用顶层 import：万一打包时漏带了依赖，顶层 import 会让整个应用起不来 ——
 * 更新只是附加功能，不该有这种权限。加载失败只记一行日志。
 */
async function ensureUpdater(): Promise<AutoUpdater | null> {
  if (loaded) {
    return updater
  }
  loaded = true

  try {
    // electron-updater 是 CJS 包：具名导出靠 Node 对 CJS 的静态分析认出来，
    // 认不出时只剩 default 上有。两条都试，省得某个版本下 autoUpdater 是 undefined。
    type UpdaterModule = typeof import('electron-updater') & {
      default?: typeof import('electron-updater')
    }
    const loadedModule = (await import('electron-updater')) as UpdaterModule
    const autoUpdater = loadedModule.autoUpdater ?? loadedModule.default?.autoUpdater
    if (!autoUpdater) {
      throw new Error('electron-updater 里没有 autoUpdater')
    }

    // 发现新版本不自动下载：先让用户看到「更新了什么」，下不下由他点
    autoUpdater.autoDownload = false
    // 下好了但用户没点「立即重启」时，下次关窗口顺手装上
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      patch({ phase: 'checking', version: '', percent: 0, message: '正在检查更新…' })
    })

    autoUpdater.on('update-available', (info) => {
      logger.info('发现新版本', { current: app.getVersion(), next: info.version })
      patch({
        phase: 'available',
        version: info.version,
        percent: 0,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        message: `发现新版本 ${info.version}。`
      })
    })

    autoUpdater.on('update-not-available', () => {
      // 自动检查没发现新版本是常态，界面上什么都不说；但日志要留下一条 ——
      // 「查不到更新」的求助只有靠这行才能区分「确实没新版本」和「地址不对但没报错」
      logger.info('已是最新版本', { current: app.getVersion() })
      patch({
        phase: state.manual ? 'up-to-date' : 'idle',
        version: '',
        percent: 0,
        message: state.manual ? '已经是最新版本。' : ''
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      patch({
        phase: 'downloading',
        percent: Math.round(progress.percent),
        message: `正在下载新版本 ${state.version}…`
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      patch({
        phase: 'downloaded',
        version: info.version,
        percent: 100,
        message: `新版本 ${info.version} 已下载，重启后生效。`
      })
    })

    autoUpdater.on('error', (error) => {
      // 失败必须留日志：这条是「查不到更新」唯一的线索，界面上的文案会随版本变，日志不会
      logger.warn('检查更新失败', {
        error: error instanceof Error ? error.message : String(error),
        message: describeFailure(error)
      })
      patch({ phase: 'error', percent: 0, message: describeFailure(error) })
    })

    updater = autoUpdater
  } catch (error) {
    logger.error('加载 electron-updater 失败，本次运行不检查更新', {
      error: error instanceof Error ? error.message : String(error)
    })
    updater = null
  }

  return updater
}

export function getUpdateState(): UpdateState {
  return state
}

/**
 * 查一次更新。manual 为 true 表示用户自己点的，界面据此把「已经是最新」「检查失败」
 * 说出来 —— 自动检查时这两种结果都保持安静。
 */
export async function checkForUpdates(manual: boolean): Promise<UpdateState> {
  /*
   * 已经在查了就不再发起第二次：两次并发的检查会让 electron-updater 把
   * up-to-date / error 各报两遍，界面上看起来就是「提示闪了一下又弹一次」。
   * 最容易撞上的时机：启动后那次自动检查还没回来，用户先点了「检查更新」。
   */
  if (state.phase === 'checking') {
    // 用户这次是主动点的：把「结果要显示出来」记在正在跑的那次身上
    if (manual && !state.manual) {
      patch({ manual: true })
    }
    return state
  }

  patch({ manual })

  // 便携版没有安装目录，把安装包装上去只会多出一份莫名其妙的副本
  if (!app.isPackaged || isPortableBuild()) {
    patch({
      phase: 'error',
      version: '',
      percent: 0,
      message: '这个版本是便携版，没有自动更新；要自动更新请用安装包版本。'
    })
    return state
  }

  // 已经在下载或下好了就别重来：重新检查会把状态打回 checking，进度条跟着倒退
  if (state.phase === 'downloading' || state.phase === 'downloaded') {
    return state
  }

  /*
   * 已经有结果摆在那儿了，自动检查不必再刷一遍 —— 重查会让提示条收起来又弹出来。
   * 手动点不受此限：那是用户明确要重新确认一次。
   */
  if (!manual && state.phase === 'available') {
    return state
  }

  const instance = await ensureUpdater()
  if (!instance) {
    patch({ phase: 'error', percent: 0, message: '这个版本里没有带上更新组件，请重新下载安装包。' })
    return state
  }

  patch({ phase: 'checking', version: '', percent: 0, message: '正在检查更新…' })
  try {
    await instance.checkForUpdates()
  } catch (error) {
    // checkForUpdates 同时也会发 error 事件，这里兜住被拒的 promise，避免变成未处理拒绝
    patch({ phase: 'error', percent: 0, message: describeFailure(error) })
  }
  return state
}

/** 用户确认后开始下载新版本；只有「已经发现新版本」时才动手 */
export async function downloadUpdate(): Promise<UpdateState> {
  if (state.phase !== 'available') {
    return state
  }

  if (!updater) {
    patch({
      phase: 'error',
      version: '',
      percent: 0,
      message: '这个版本里没有带上更新组件，请重新下载安装包。'
    })
    return state
  }

  patch({ phase: 'downloading', percent: 0, message: `正在下载新版本 ${state.version}…` })
  try {
    await updater.downloadUpdate()
  } catch (error) {
    patch({ phase: 'error', percent: 0, message: describeFailure(error) })
  }
  return state
}

/**
 * 下载完成后立即重启并安装。
 *
 * 两个参数都得显式给：不传的话 electron-updater 的 isSilent 默认是 false，
 * 安装程序会弹出向导 —— 用户已经点过「重启并更新」，不该再被问一遍；
 * isForceRunAfter 也只在 isSilent 为 true 时才被认，否则装完应用不会自己回来。
 */
export function installUpdate(): void {
  updater?.quitAndInstall(true, true)
}

/** 系统会话正在结束（关机 / 重启 / 注销） */
let sessionEnding = false

/**
 * 关机时不装更新。
 *
 * electron-updater 默认会在应用退出时把已下载的更新装上，但如果这次退出是系统关机，
 * Windows 会在安装程序跑到一半时把它掐掉，留下「旧的卸了、新的没装上」的残局
 * （electron-builder issue #7807）。Windows 上拿不到 powerMonitor 的 shutdown 事件，
 * 但每个窗口都会收到 session-end，那就是关机/注销的信号。
 */
function installSessionEndGuard(): void {
  app.on('browser-window-created', (_event, win) => {
    win.on('session-end', () => {
      sessionEnding = true
    })
  })

  app.on('before-quit', () => {
    if (sessionEnding && updater) {
      updater.autoInstallOnAppQuit = false
    }
  })
}

/** 装好更新检查。只有安装版才会真的去查 */
export function initUpdater(): void {
  // 关机守卫跟「是不是安装版」无关，先挂上
  installSessionEndGuard()

  if (!app.isPackaged || isPortableBuild()) {
    return
  }
  const timer = setTimeout(() => {
    // 开关在定时器**触发时**读，而不是 initUpdater 时读：用户在这 15 秒里关掉它也该生效
    if (!getAutoCheckUpdate()) {
      logger.info('已关闭启动时自动检查更新，跳过这次')
      return
    }
    void checkForUpdates(false)
  }, STARTUP_CHECK_DELAY_MS)
  // 别让这个定时器把进程留在后台
  timer.unref?.()
}
