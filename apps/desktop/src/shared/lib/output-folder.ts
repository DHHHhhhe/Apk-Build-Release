/**
 * 统一输出目录下的归档文件夹名。
 *
 * 放在 shared 里是因为**界面也要用它**：抽屉里显示「产物会归档到哪」时，
 * 如果渲染层自己拼一遍名字，就会出现「界面预览一个目录、实际落到另一个目录」——
 * 这条规则只有一处实现，两边才走不散。
 */

/** 挡掉文件名非法字符；全被挡掉时给一个兜底名，免得拼出空路径段 */
export function sanitizeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
}

/**
 * 输出目录下的子文件夹名：**优先用别名**。
 *
 * 同一个模板工程常常按渠道分发成好几个 App，别名就是分发名；按别名归档，
 * 输出目录里一眼能看出哪个包属于哪个渠道，而不是一堆同名的模板工程目录。
 */
export function resolveOutputFolderName(project: { alias: string | null; name: string }): string {
  const alias = project.alias?.trim() ?? ''
  // 别名是用户随手填的，必须先挡住路径分隔符与「上一级」：否则 join 之后会跑出统一输出目录。
  // （项目名来自目录 basename，本来就没有分隔符；别名没有这个天然保证。）
  const flattenedAlias = alias.replace(/[\\/]+/g, '-').replace(/\.{2,}/g, '-').trim()
  const source = flattenedAlias.length > 0 ? flattenedAlias : project.name
  return sanitizeSegment(source)
}
