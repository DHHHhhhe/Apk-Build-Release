/**
 * 自动更新的对外状态。
 *
 * 主进程是唯一真值：它跑 electron-updater，每次变化都推给渲染层；
 * 渲染层只做两件事 —— 订阅（onState）与主动查（check）。
 */
export type UpdatePhase =
  /** 没在检查，也没有待处理的更新 */
  | 'idle'
  /** 正在问服务器 */
  | 'checking'
  /** 有新版本，等用户决定下不下（自动下载是关着的，下载由用户点出来） */
  | 'available'
  /** 下载中 */
  | 'downloading'
  /** 下好了，等用户重启 */
  | 'downloaded'
  /** 已经是最新（只有手动检查才看得到） */
  | 'up-to-date'
  /** 检查或下载失败 */
  | 'error'

export interface UpdateState {  phase: UpdatePhase
  /** 当前运行的版本 */
  currentVersion: string
  /** 新版本号；没有可用更新时为空串 */
  version: string
  /** 下载进度 0-100，不在下载时为 0 */
  percent: number
  /** 给用户看的中文说明 */
  message: string
  /** 这次检查是不是用户手动点的：自动检查失败时不该弹提示打扰人 */
  manual: boolean
  /** 新版本更新了什么（来自 Release 正文）；拿不到时是空串 */
  releaseNotes: string
  /**
   * 这个形态有没有自动更新。
   *
   * 打包后为 true —— 现在只发安装版，装上去就是它该在的位置。
   * 开发态也为 true：那时检查会走「开发模式」那条分支并给出明确提示，
   * 本地得先看得见这个入口才能自测。
   */
  canUpdate: boolean
}

/**
 * 「这次启动是刚更新上来的」。
 *
 * 只有启动时能取到、**取一次就没了**：静默安装那几十秒应用是关着的，用户重开时
 * 需要知道「刚才那下成了」，但同一版反复启动不该每次都说一遍。
 */
export interface LaunchNotice {
  /** 上一版版本号。从还不认识版本记录的旧版升上来时没有这一项 */
  from?: string
  /** 现在的版本 */
  to: string
}
