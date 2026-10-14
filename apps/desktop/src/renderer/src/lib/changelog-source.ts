// 构建时把 CHANGELOG 整份内联进包（Vite 的 ?raw）：界面断网也能看更新记录。
// 不走 GitHub API 是有意的 —— 这个工具常在内网分发，从外面拉一份列表未必拿得到。
import raw from '../../../../../../CHANGELOG.md?raw'

export const CHANGELOG_MARKDOWN: string = raw
