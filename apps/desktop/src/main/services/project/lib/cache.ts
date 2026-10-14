import { statSync } from 'node:fs'

/**
 * 缓存签名 = 参与解析的文件的 mtime 组合（与 androkit 的做法一致）。
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
  return parts.join('|')
}

export function isSignatureCurrent(previous: string | null, files: string[]): boolean {
  if (!previous || files.length === 0) {
    return false
  }
  return previous === computeSignature(files)
}
