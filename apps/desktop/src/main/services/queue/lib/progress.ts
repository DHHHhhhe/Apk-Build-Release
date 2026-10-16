import { BrowserWindow } from 'electron'
import { listItems } from './items'

/**
 * 任务栏进度条。
 *
 * 口径：分母是队列里的全部项，分子是已结束的项 —— 用户看到的是「这批还剩多少」。
 * 只有队列里还有排队或正在跑的项时才显示；跑完或清空后立刻清掉，
 * 免得进度条挂在那里让人以为还没结束。
 *
 * 拿不到窗口（比如测试环境）时什么也不做。
 */
export function syncTaskbarProgress(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    return
  }

  const items = listItems(200)
  const active = items.filter((item) => item.state === 'pending' || item.state === 'running').length
  if (active === 0) {
    win.setProgressBar(-1)
    return
  }

  const finished = items.filter(
    (item) => item.state !== 'pending' && item.state !== 'running'
  ).length
  win.setProgressBar(finished / items.length)
}
