import type { ProjectVariant } from '@shared/types/project'

/**
 * 只声明真正用到的字段：这个判断只看 flavor 与 buildType，
 * 不该要求调用方造出一个完整的变体对象（也与 filterVariantsForPackaging 的写法一致）。
 */
type BadgeInput = Pick<ProjectVariant, 'flavor' | 'buildType'>

export interface VariantBadgeVisibility {
  /** 项目里有多个 flavor 时才逐行显示 flavor */
  flavor: boolean
  /** 可见变体的 buildType 不统一时才逐行显示 buildType */
  buildType: boolean
}

export interface VariantBadgeOptions {
  /**
   * 强制显示 buildType。
   *
   * 用在「项目没有 release 变体、列表回退成全部变体」的时候：那种情况下列表里只有
   * debug 一种 buildType，「不统一才显示」的规则会把唯一的区分依据藏掉，
   * 用户就看不出自己在打 debug 包（见 isPackagingFallback）。
   */
  forceBuildType?: boolean
}

/**
 * 变体行里哪些类型标签值得显示。
 *
 * 判据是「这个标签能不能起区分作用」：整列都写着 `release`，逐行再重复一遍只是噪音 ——
 * 「只出 release 包」这条规则已经由列表本身表达了，不需要每行声明一次。
 * flavor 同理：单一 flavor 的项目里它也是个恒定的标签。
 *
 * 反过来，多 flavor（free / paid）或多 buildType 的项目里，这些标签是区分行的唯一依据，必须显示。
 */
export function variantBadgeVisibility(
  variants: BadgeInput[],
  options: VariantBadgeOptions = {}
): VariantBadgeVisibility {
  const flavors = new Set(
    variants.map((variant) => variant.flavor).filter((flavor): flavor is string => Boolean(flavor))
  )
  const buildTypes = new Set(variants.map((variant) => variant.buildType))
  return {
    flavor: flavors.size > 1,
    buildType: buildTypes.size > 1 || options.forceBuildType === true
  }
}
