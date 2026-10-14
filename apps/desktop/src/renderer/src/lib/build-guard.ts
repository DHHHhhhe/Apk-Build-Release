import { ONLY_DEBUG_SELECTED_REASON } from '@shared/lib/variants'

/**
 * 「构建勾选项」这个动作能不能点、不能点时为什么不能点。
 *
 * 抽成纯函数有两个理由：
 * 1. 顶栏按钮与表内按钮是**同一个动作的两个位置**，判断逻辑必须字字相同，否则两处会出现
 *    「一个能点一个不能点」的怪状；
 * 2. 仓库没有渲染测试设施，hook 靠抽纯函数来测（见 useSidebarWidth 的做法），
 *    把判断抽出来才能覆盖到。
 *
 * 注意单位：变体数与项目数是**两个不同的量**。N（按钮上的数字）数的是变体，
 * 而「都被队列占了」这件事判的是项目 —— 混着比会得出「2 个变体 = 2 个项目」这种巧合正确、
 * 实则错误的结果。
 */
export interface BuildGuardInput {
  /** 尚未落盘的勾选写入数量 */
  pendingWrites: number
  /** 会被构建的变体数（按钮上显示的那个 N） */
  buildableVariantCount: number
  /** 勾选里能真正入队的项目数（有可构建变体、且不在队列中） */
  pendingProjectCount: number
  /** 勾选里因已在队列中而被跳过的项目数 */
  queuedProjectCount: number
  /** 勾了但被出包规则挡下的（debug） */
  hiddenSelectedCount: number
  /** 勾了但项目里已经没有这个变体的 */
  unknownSelectedCount: number
}

/** 不能构建时返回原因，可以构建时返回 null */
export function buildBlockedReason(input: BuildGuardInput): string | null {
  if (input.pendingWrites > 0) {
    return '正在保存勾选…'
  }
  if (input.buildableVariantCount === 0) {
    if (input.hiddenSelectedCount > 0) {
      // 与主进程入队时的拒绝原因共用同一句，避免两处文案各说各话
      return ONLY_DEBUG_SELECTED_REASON
    }
    if (input.unknownSelectedCount > 0) {
      return '勾选的变体已不在项目里，先刷新变体'
    }
    return '先勾选至少一个发布变体'
  }
  if (input.pendingProjectCount === 0) {
    return '勾选的项目都在队列里了'
  }
  return null
}

/** 提示后缀：勾选里有多少项目会被跳过，让「按了没反应」不再发生 */
export function queuedExclusionHint(input: BuildGuardInput): string | null {
  if (input.queuedProjectCount === 0 || input.pendingProjectCount === 0) {
    return null
  }
  return `另有 ${input.queuedProjectCount} 个项目已在队列中，本次会跳过`
}

/**
 * 真正要入队的项目 id：有可构建变体、且不在队列中。
 *
 * 抽成纯函数有两个原因：一是这段判断按下按钮时才会执行，留在组件里测不到；
 * 二是顶栏按钮与表内按钮必须发出同一份 id 列表，两处共用才不会走散。
 */
export function projectsToEnqueue(
  projects: Array<{ id: string }>,
  resolutions: Map<string, { buildable: string[] }>,
  queuedProjectIds: Set<string>
): string[] {
  return projects
    .filter((project) => (resolutions.get(project.id)?.buildable.length ?? 0) > 0)
    .filter((project) => !queuedProjectIds.has(project.id))
    .map((project) => project.id)
}
