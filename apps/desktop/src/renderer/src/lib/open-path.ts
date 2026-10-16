import { toast } from 'sonner'

/**
 * 打开目录或文件，失败时给一条看得见的提示。
 *
 * 以前各处写的是 `void window.api.settings.openPath(...)`：主进程返回的失败被丢掉，
 * 用户看到的是「点了没反应」。而打开路径恰好是最容易失败的一类操作 —— 目录被删、
 * 文件被移走、没有关联程序、路径太长。所以统一在这里兜住，别再各写一遍。
 */
export async function openPathOrToast(path: string, label: string): Promise<void> {
  if (path.trim() === '') {
    toast.error(`${label}：路径是空的`)
    return
  }
  try {
    const result = await window.api.settings.openPath(path)
    if (!result.success) {
      toast.error(result.error ?? `打不开${label}`)
    }
  } catch (error) {
    toast.error(`${label}打不开：${error instanceof Error ? error.message : '未知错误'}`)
  }
}
