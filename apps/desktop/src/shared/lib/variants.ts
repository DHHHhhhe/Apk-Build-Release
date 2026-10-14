/**
 * 变体筛选共用的判断。
 * 放在 shared 里是因为渲染进程要按它决定列表显示什么，主进程也可能按它做校验。
 */

/** buildType 是否为发布类型 */
export function isReleaseBuildType(buildType: string): boolean {
  return buildType.trim().toLowerCase() === 'release'
}

/**
 * 打包工具默认只关心发布变体：
 * debug 包由 SDK 调试密钥签名，按 Android 官方说法「不能发布到应用商店」，
 * 属于开发自测产物，不该混在批量出包的列表里。
 */
export function filterVariantsForPackaging<T extends { buildType: string }>(variants: T[]): T[] {
  const release = variants.filter((variant) => isReleaseBuildType(variant.buildType))
  // 一个项目连 release 变体都没有时不能把列表清空，否则用户无从下手
  return release.length > 0 ? release : variants
}
