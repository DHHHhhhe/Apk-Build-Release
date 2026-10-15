import { useEffect } from 'react'
import { toast } from 'sonner'
import { useUpdate } from '../hooks/useUpdate'

/**
 * 手动检查更新的结果。
 *
 * 用 sonner 而不是自己搓一张卡片：参考实现用的就是它
 * （`<Toaster position="bottom-right" richColors closeButton />` + `toast.success`），
 * 自己再写一套只会两边的样式越走越远 —— 手搓那份连「成功该是绿的」都得自己记得。
 *
 * 自动检查的结果照旧不占位置：只有用户自己点过「检查更新」才提示。
 */
export function UpdateResultToast(): null {
  const update = useUpdate()
  const state = update.state

  useEffect(() => {
    if (!state?.manual) {
      return
    }
    // 同一个 id：连着点「检查更新」时替换上一条，不会叠一摞
    if (state.phase === 'up-to-date') {
      toast.success('已经是最新版本。', { id: 'update-check' })
    }
    if (state.phase === 'error') {
      toast.error(state.message, { id: 'update-check' })
    }
  }, [state?.manual, state?.phase, state?.message])

  return null
}