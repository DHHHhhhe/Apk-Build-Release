/** 抽屉与主列的宽度约束。放在这里是为了让判定逻辑可测，界面只负责套用 */

/** 抽屉宽度下限：再窄就放不下构建记录的日志行 */
export const DRAWER_MIN_WIDTH = 420

/** 自动宽度的上限：里面是变体列表、环境自检与构建记录三块，560 已经够宽 */
export const DRAWER_MAX_WIDTH = 560

/** 手动拖动的范围：允许拖到比自动值宽（看长日志），也允许略窄 */
export const DRAWER_DRAG_MIN = 380
export const DRAWER_DRAG_MAX = 900

/**
 * 抽屉占窗口宽度的比例。
 *
 * 固定宽度在默认的 1280 窗口下会吃掉四成内容区，所以让它随窗口缩放：
 * 小窗口拿小抽屉，大窗口拿满上限。
 */
const DRAWER_WIDTH_RATIO = 0.4

/**
 * 主列的最小可用宽度。
 *
 * 勾选行是「复选框 + 变体名 + 徽标」的一行三栏，约 320px 才不折行；
 * 分组头那排按钮放不下时会自己换行，所以主列真正的地板在 480 附近。
 */
export const MAIN_MIN_WIDTH = 480

/**
 * 覆盖模式下留给主列的最小可操作宽度。
 *
 * 不留的话窄窗口下抽屉会把主列盖满整屏：主列虽然还「在」，但右侧那排操作
 * （全选本项目 / 清空 / 取消 / 清空队列）全都压到抽屉底下，表现为点了没反应。
 * 320 是「勾选行 + 一两个动作按钮」能排下的宽度；主列因此被压得很窄，但可操作。
 */
const OVERLAP_MAIN_MIN = 320

/** 抽屉打开时主列怎么摆 */
export type DrawerMode = 'avoid' | 'overlap'

export interface DrawerLayout {
  /** 抽屉实际宽度（像素），同时用于 CSS 变量与「主列让开多少」 */
  width: number
  /** avoid = 主列整列让开；overlap = 空间不够，抽屉盖在右侧 */
  mode: DrawerMode
}

/** 没拖过时按窗口宽度算的宽度（下限 420、上限 560、中间按比例） */
export function preferredDrawerWidth(windowWidth: number): number {
  const scaled = Math.round(windowWidth * DRAWER_WIDTH_RATIO)
  return Math.max(DRAWER_MIN_WIDTH, Math.min(scaled, DRAWER_MAX_WIDTH))
}

/**
 * 抽屉打开时的布局：宽度与「主列是否避让」一次算出来。
 *
 * 以前这是两个独立的判断 —— 避让按 resolveDrawerWidth 算（1280 下 512），
 * 而抽屉自己按用户拖的宽度画（默认 560）。两个数不一致时，避让也白搭：
 * 主列按 512 让开、抽屉按 560 画，右边仍有 48px 被压住。
 * 所以宽度与模式必须出自同一个函数。
 *
 * 宽度也不是「用户拖多少就是多少」：它同时受可用空间约束 —— 用户把抽屉拖到 900，
 * 而窗口只有 1280 时会被压到 528，否则避让没有意义（主列被挤到地板以下）。
 * 空间连下限都放不下时进入 overlap 模式，界面按模式把那排右对齐的操作挪到左侧。
 */
export function resolveDrawerLayout(input: {
  windowWidth: number
  sidebarWidth: number
  /** 用户拖出来的偏好宽度；不传按窗口比例推算 */
  preferredWidth?: number
}): DrawerLayout {
  const preferred = input.preferredWidth ?? preferredDrawerWidth(input.windowWidth)
  const available = input.windowWidth - input.sidebarWidth - MAIN_MIN_WIDTH

  if (available >= DRAWER_MIN_WIDTH) {
    return {
      width: Math.max(DRAWER_MIN_WIDTH, Math.min(preferred, DRAWER_DRAG_MAX, available)),
      mode: 'avoid'
    }
  }

  /*
   * 放不下：抽屉盖在右侧，宽度只受「留给主列多少」约束。
   * 下限用拖动下限（380）而不是自动下限（420）：这时窄一点换来主列可操作是划算的 ——
   * 420 的下限是为了日志行不折行，而主列如果只剩一百来像素，用户连取消构建都点不到。
   */
  const capped = Math.max(DRAWER_DRAG_MIN, input.windowWidth - input.sidebarWidth - OVERLAP_MAIN_MIN)
  return {
    width: Math.max(DRAWER_DRAG_MIN, Math.min(preferred, DRAWER_DRAG_MAX, capped)),
    mode: 'overlap'
  }
}
