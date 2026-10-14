/** 抽屉与主列的宽度约束。放在这里是为了让判定逻辑可测，界面只负责套用 */

/** 抽屉宽度下限：再窄就放不下构建记录的日志行 */
export const DRAWER_MIN_WIDTH = 420

/** 抽屉宽度上限：里面是变体列表、环境自检与构建记录三块，560 已经够宽 */
export const DRAWER_MAX_WIDTH = 560

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
 * 低于它就别避让了 —— 挤成一条的主列没法用，宁可让抽屉盖住。
 */
export const MAIN_MIN_WIDTH = 480

/** 按窗口宽度算抽屉该多宽（下限 420、上限 560、中间按比例） */
export function resolveDrawerWidth(windowWidth: number): number {
  const scaled = Math.round(windowWidth * DRAWER_WIDTH_RATIO)
  return Math.max(DRAWER_MIN_WIDTH, Math.min(scaled, DRAWER_MAX_WIDTH))
}

export interface AvoidDrawerInput {
  windowWidth: number
  sidebarWidth: number
  /** 不传就按 windowWidth 推算，与界面用的是同一个函数 */
  drawerWidth?: number
}

/**
 * 抽屉打开时，主列该避让还是让它盖住。
 *
 * 避让更好：抽屉不会盖住主列右侧那排组内操作按钮（全选/清空/只选某类型）。
 * 但避让的前提是主列避让后仍够宽 —— 不够就宁可盖住。
 * 侧栏宽度是用户可拖的，所以必须按实际宽度算，不能用写死的窗口阈值。
 */
export function shouldAvoidDrawer(input: AvoidDrawerInput): boolean {
  const drawerWidth = input.drawerWidth ?? resolveDrawerWidth(input.windowWidth)
  return input.windowWidth - input.sidebarWidth - drawerWidth >= MAIN_MIN_WIDTH
}
