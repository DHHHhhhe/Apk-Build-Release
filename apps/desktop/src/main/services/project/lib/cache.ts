import { statSync } from 'node:fs'

/**
 * 静态解析器的版本。**改了静态解析的逻辑就要抬它。**
 *
 * 签名里带上版本号，解析逻辑一变，老项目缓存的变体结果会在下次打开时自动重算 ——
 * 否则文件 mtime 没变，用户就会一直拿着旧结果，还得自己想起来点「刷新变体」。
 *
 * v2：注释剥离改成字符串感知。此前字符串里的 `//` 会把它那一行截断（连结尾引号一起），
 *     引号与花括号配平全乱，`productFlavors` 读不出来 —— 界面上只剩一个假定出来的 Release。
 */
export const STATIC_PARSE_VERSION = 2

/**
 * 缓存签名 = 解析器版本 + 参与解析的文件的 mtime 组合（与 androkit 的做法一致）。
 * 文件没变就不用重新解析，添加项目时可以秒出变体列表。
 */
export function computeSignature(files: string[]): string {
  const parts = files
    .map((file) => {
      try {
        return `${file}:${Math.round(statSync(file).mtimeMs)}`
      } catch {
        return `${file}:missing`
      }
    })
    .sort()
  return `v${STATIC_PARSE_VERSION}|${parts.join('|')}`
}

export function isSignatureCurrent(previous: string | null, files: string[]): boolean {
  if (!previous || files.length === 0) {
    return false
  }
  return previous === computeSignature(files)
}
