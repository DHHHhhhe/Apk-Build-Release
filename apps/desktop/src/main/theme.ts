import { nativeTheme, BrowserWindow } from 'electron'
import { logger as baseLogger } from './services/logger'
import { getThemeChoice, setThemeChoice } from './services/build/lib/settings'
import type { ThemeChoice } from '../shared/types/settings'

const logger = baseLogger.scope('theme')

/**
 * 窗口底色。Chromium 在首帧之前画的就是它 —— 深色下如果给白色，启动瞬间会闪一下白。
 *
 * 取值对齐 `renderer/src/styles/tokens.css` 里 `:root` 与 `.dark` 的 `--background`：
 * 浅色 `#f2f2f4`、深色 `#0c0c0e`。改了令牌就要同步这里，否则首帧会露馅。
 */
const BACKGROUND_LIGHT = '#f2f2f4'
const BACKGROUND_DARK = '#0c0c0e'

/** 当前该用的窗口底色。必须在 themeSource 设好之后调用 */
export function backgroundForDark(dark: boolean): string {
  return dark ? BACKGROUND_DARK : BACKGROUND_LIGHT
}

export function currentBackgroundColor(): string {
  return backgroundForDark(nativeTheme.shouldUseDarkColors)
}

/**
 * 把主题选择交给 Electron。
 *
 * `nativeTheme.themeSource` 是**唯一**的真源：设成 dark 会让渲染层的 `prefers-color-scheme`
 * 匹配 dark，也让 Electron 自绘的界面（右键菜单、DevTools）与系统画的窗口边框一起变深。
 * 渲染层因此不自己判断「选的是哪一档」，照抄媒体查询的结果即可 —— 少一处可能对不上的判断。
 */
export function applyNativeTheme(choice: ThemeChoice): void {
  nativeTheme.themeSource = choice
  const background = currentBackgroundColor()
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(background)
  }
}

/** 读盘上的选择并应用。建窗口**之前**调用，返回实际生效的档位 */
export function initTheme(): ThemeChoice {
  const choice = getThemeChoice()
  applyNativeTheme(choice)
  logger.info('应用主题档位', { choice, dark: nativeTheme.shouldUseDarkColors })
  return choice
}

/** 用户切换主题：落盘 + 立即生效 */
export function saveTheme(choice: ThemeChoice): ThemeChoice {
  setThemeChoice(choice)
  applyNativeTheme(choice)
  logger.info('主题档位已更新', { choice, dark: nativeTheme.shouldUseDarkColors })
  return choice
}
