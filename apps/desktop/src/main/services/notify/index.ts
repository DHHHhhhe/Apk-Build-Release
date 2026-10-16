import { BrowserWindow, Notification } from 'electron'
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
 *
 * 点通知回窗口：用户看到「跑完了」的第一反应就是回去拿包，
 * 而这时窗口多半还在最小化或别的窗口后面，只弹一条通知等于让他自己找。
 */
export function notifyBuildFinished(input: BuildNotification): void {
  try {
    if (!Notification.isSupported()) {
      return
    }
    const notification = new Notification({ title: input.title, body: input.body })
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) {
        return
      }
      if (win.isMinimized()) {
        win.restore()
      }
      win.show()
      win.focus()
    })
    notification.show()
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.warn('系统通知发送失败', { error: message })
  }
}
