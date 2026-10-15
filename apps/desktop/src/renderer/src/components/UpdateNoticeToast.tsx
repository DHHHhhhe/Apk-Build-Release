import { useEffect } from 'react'
import { toast } from 'sonner'

/**
 * 「已更新到 vX」。
 *
 * 与参考实现同一套：走 sonner，8 秒后收起（比默认长一些 —— 这条是「刚才发生了什么」的回执，
 * 用户可能正看着别处），并注明上一版是哪一版。
 *
 * 取一次就没了（主进程侧是 consume 语义），所以放在空依赖的 effect 里。
 */
export function UpdateNoticeToast(): null {
  useEffect(() => {
    void window.api.update
      .takeLaunchNotice()
      .then((notice) => {
        if (!notice) {
          return
        }
        toast.success(`已更新到 v${notice.to}`, {
          // from 为空表示只知道更新过、不知道从哪一版来（从还不认识版本记录的旧版升上来的那次）
          description: notice.from ? `上一版是 v${notice.from}` : undefined,
          duration: 8000
        })
      })
      .catch((error: unknown) => {
        // 提示本身失败不该影响启动，记一行就够
        console.error('[update] 读取版本变化提示失败', error)
      })
  }, [])

  return null
}