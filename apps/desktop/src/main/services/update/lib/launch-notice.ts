import { app } from 'electron'
import { getLastRunVersion, hasStoredSettings, setLastRunVersion } from '../../build/lib/settings'
import type { LaunchNotice } from '@shared/types/update'

/**
 * 「这次启动算不算刚更新过」。
 *
 * 纯函数：把三个输入摊开，方便把三种边界都测到。
 *
 * 最容易被漏掉的是第三种：**带上版本记录的第一个版本，自己看不到自己的提示** ——
 * 用户升级到它的时候，跑的还是旧版代码，而旧版压根不写这个字段。所以判据不能是
 * 「有没有记录」，而要是「有没有别的设置」：
 *
 * - 什么都没有 → 首次安装，不提示（这不是「更新」，提示会让人以为刚出了什么事）
 * - 有设置、没版本记录 → 从旧版升上来，要提示，但说不清从哪一版来，省掉「上一版是」
 * - 有版本记录且与当前不同 → 正常更新，带上「上一版是」
 */
export function decideLaunchNotice(input: {
  previous: string | null
  current: string
  hasStoredSettings: boolean
}): LaunchNotice | null {
  if (input.previous === null) {
    return input.hasStoredSettings ? { to: input.current } : null
  }
  if (input.previous === input.current) {
    return null
  }
  return { from: input.previous, to: input.current }
}

let cached: LaunchNotice | null = null
let taken = false

/**
 * 取这次启动的更新提示，**取一次就没了**（consume 语义）。
 *
 * 不缓存的话，每开一个窗口都会再弹一遍；缓存但不清空，同一个窗口重渲染又会再来一次。
 * 顺带把「本次运行的版本」落盘，供下次启动比对。
 */
export function takeLaunchNotice(): LaunchNotice | null {
  if (taken) {
    return null
  }
  taken = true

  cached = decideLaunchNotice({
    previous: getLastRunVersion(),
    current: app.getVersion(),
    hasStoredSettings: hasStoredSettings()
  })
  setLastRunVersion(app.getVersion())
  return cached
}
