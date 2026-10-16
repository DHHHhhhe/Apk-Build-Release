/** 路径的显示用拼接：渲染进程没有 node:path，只需要「看起来对」的一层 */
export function dirnameOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  return index > 0 ? filePath.slice(0, index) : filePath
}

/**
 * 把输出目录与子文件夹名拼成一条可读路径。
 *
 * 分隔符跟着输入走（Windows 的盘符路径用反斜杠，其余用斜杠），
 * 免得界面上出现 `C:\Users\demo/示例` 这种混搭。
 */
export function joinDisplayPath(root: string, segment: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return root.endsWith(separator) ? `${root}${segment}` : `${root}${separator}${segment}`
}
