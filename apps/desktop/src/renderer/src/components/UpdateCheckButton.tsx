import { Download, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { useUpdate } from '../hooks/useUpdate'

/**
 * 左下角的「检查更新」。
 *
 * 摆在版本号旁边：查更新和看版本本来就是一件事，想知道「有没有新版本」时眼睛就在这一块。
 *
 * 只在有自动更新的形态上出现（`canUpdate` 由主进程给）：便携版点它只会得到一句
 * 「这个版本是便携版」，不如不出现。
 *
 * 文案与动作跟着主进程推来的阶段走，**本地不记第二份**：从别处触发的检查，这个按钮也该
 * 变成「检查中」。两种「什么都没发生」的结果（已是最新 / 检查失败）不在按钮上再说一遍 ——
 * 设置里的更新区块已经在收尾了，这里重复就是同一件事说两次。
 */
export function UpdateCheckButton(): React.JSX.Element | null {
  const update = useUpdate()
  const phase = update.state?.phase

  // 状态还没接上时先不出现，免得左下角闪一下
  if (!update.state?.canUpdate) {
    return null
  }

  if (phase === 'downloaded') {
    return (
      <button type="button" className="app-sidebar__action" onClick={() => void update.install()}>
        <Download size={14} aria-hidden="true" />
        重启并安装
      </button>
    )
  }

  if (phase === 'available') {
    return (
      <button type="button" className="app-sidebar__action" onClick={() => void update.download()}>
        <Download size={14} aria-hidden="true" />
        下载 {update.state.version}
      </button>
    )
  }

  const checking = phase === 'checking' || phase === 'downloading'

  return (
    <button
      type="button"
      className="app-sidebar__action"
      disabled={checking}
      onClick={() => void update.check()}
    >
      <RefreshCw size={14} aria-hidden="true" className={checking ? 'spin' : undefined} />
      {phase === 'checking' ? '检查中…' : phase === 'downloading' ? `下载中 ${update.state.percent}%` : '检查更新'}
    </button>
  )
}
