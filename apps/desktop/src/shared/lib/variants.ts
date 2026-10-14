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

/** 勾选里只有 debug 变体时的拒绝原因：主进程与界面共用同一句，避免两边文案漂移 */
export const ONLY_DEBUG_SELECTED_REASON = '勾选的只有 debug 变体，出包不带 debug'

export interface BuildableVariantsInput<T extends { name: string; buildType: string }> {
  variants: T[]
  selected: string[]
  /** 是否把 debug 变体也算进可构建范围（界面上的「显示 debug 变体」开关；主进程恒为 false） */
  includeDebug: boolean
}

export interface BuildableVariantsResult {
  /** 真的会被构建的变体名，保持勾选顺序 */
  buildable: string[]
  /** 勾了但被出包规则挡下的（当前规则下就是 debug） */
  hiddenSelected: string[]
  /** 勾了但项目里已经没有这个变体了（变体被改名或删掉） */
  unknownSelected: string[]
}

/**
 * 「这次会打哪些包」的唯一实现 —— 主进程入队与界面展示都必须走这里。
 *
 * 两边各写一份的代价已经付过一次：debug 变体刚过滤时，界面隐藏了、主进程却照旧构建，
 * 出现「列表里看不见的变体照样被打包」。同一份规则只留一处，才不会再次走散。
 */
export function resolveBuildableVariants<T extends { name: string; buildType: string }>(
  input: BuildableVariantsInput<T>
): BuildableVariantsResult {
  const known = new Set(input.variants.map((variant) => variant.name))
  const visible = new Set(
    (input.includeDebug ? input.variants : filterVariantsForPackaging(input.variants)).map(
      (variant) => variant.name
    )
  )

  // 先按「项目里还存不存在」筛一遍，再区分「被出包规则挡下」与「不存在」，
  // 否则改名留下的旧勾选会被当成 debug 变体报错，提示词就骗人了
  const knownSelected = input.selected.filter((name) => known.has(name))

  return {
    buildable: knownSelected.filter((name) => visible.has(name)),
    hiddenSelected: knownSelected.filter((name) => !visible.has(name)),
    unknownSelected: input.selected.filter((name) => !known.has(name))
  }
}
