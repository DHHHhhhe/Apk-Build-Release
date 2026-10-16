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
 *
 * 这是本工具的规则本身，界面上不再解释它、也不提供绕开的入口。
 */
export function filterVariantsForPackaging<T extends { buildType: string }>(variants: T[]): T[] {
  const release = variants.filter((variant) => isReleaseBuildType(variant.buildType))
  // 一个项目连 release 变体都没有时不能把列表清空，否则用户无从下手
  return release.length > 0 ? release : variants
}

/**
 * 列表是不是「回退成全部变体」了。
 *
 * 回退本身是体贴（不然用户面对空列表），但**必须说出来**：回退后列表里只有 debug，
 * 而 buildType 徽章在「只有一种类型」时默认不显示，两个体贴叠在一起的结果是
 * 用户完全看不出自己在打 debug 包，包发出去了才知道没签名。
 *
 * 判据与 filterVariantsForPackaging 的回退条件严格对应：有变体、且一个 release 都没有。
 */
export function isPackagingFallback<T extends { buildType: string }>(variants: T[]): boolean {
  return variants.length > 0 && !variants.some((variant) => isReleaseBuildType(variant.buildType))
}

/** 回退时列表上方那句说明；三处列表（勾选表 / 项目详情 / 侧栏计数）共用同一份措辞 */
export const PACKAGING_FALLBACK_NOTE = '这个项目没有 release 变体，下面列的是全部变体（debug 包不能上架）'

/**
 * 勾了变体、但一个都出不了包时的说明（例如旧版本留下的 debug 勾选）。
 * 主进程跳过该项目时用它，措辞与界面上的提示保持一致。
 */
export const NO_BUILDABLE_VARIANT_REASON = '没有可出包的 release 变体'

export interface BuildableVariantsInput<T extends { name: string; buildType: string }> {
  variants: T[]
  selected: string[]
}export interface BuildableVariantsResult {
  /** 真的会被构建的变体名，保持勾选顺序 */
  buildable: string[]
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
  const visible = new Set(filterVariantsForPackaging(input.variants).map((variant) => variant.name))

  // 先按「项目里还存不存在」筛一遍：改名或删变体留下的旧勾选要归到 unknown，
  // 不能和「被出包规则挡下」混成同一类，否则提示词就骗人了
  const knownSelected = input.selected.filter((name) => known.has(name))

  return {
    buildable: knownSelected.filter((name) => visible.has(name)),
    unknownSelected: input.selected.filter((name) => !known.has(name))
  }
}
