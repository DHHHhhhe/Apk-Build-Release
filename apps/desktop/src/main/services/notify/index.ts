import { Notification } from 'electron'
import { logger as baseLogger } from '../logger'

const logger = baseLogger.scope('notify')

export interface BuildNotification {
  title: string
  body: string
}

/**
 * 构建结束的系统通知。
 * 一次构建可能好几分钟，用户切走之后需要知道跑完了。
 * 未打包的 Windows 应用没有开始菜单快捷方式时 toast 可能不显示，所以这里失败只记日志、不抛。
 */
export function notifyBuildFinished(input: BuildNotification): void {
  try {
    if (!Notification.isSupported()) {
      return
    }
    new Notification({ title: input.title, body: input.body }).show()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('系统通知发送失败', { error: message })
  }
}
