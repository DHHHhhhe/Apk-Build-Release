import type { QueueItem } from '@shared/types/queue'
import type { EnqueueTarget } from '@shared/types/queue'

/**
 * 「构建勾选项」这个动作能不能点、不能点时为什么不能点。
 *
 * 抽成纯函数有两个理由：
 * 1. 顶栏按钮与表内按钮是**同一个动作的两个位置**，判断逻辑必须字字相同，否则两处会出现
 *    「一个能点一个不能点」的怪状；
 * 2. 仓库没有渲染测试设施，hook 靠抽纯函数来测（见 useSidebarWidth 的做法），
 *    把判断抽出来才能覆盖到。
 *
 * 口径从「项目」改成了「变体」：一个项目在队列里跑着某个变体时，另一个变体仍然可以入队，
 * 所以「这个项目在队列里」不再等于「这次没有可入队的东西」。
 */
export interface BuildGuardInput {
  /** 这次会真正入队的变体数（已剔除队列里占用的） */
  buildableVariantCount: number
  /** 勾选里因已在队列中被剔除的变体数 */
  queuedVariantCount: number
  /** 还有可入队变体的项目数 */
  pendingProjectCount: number
  /** 勾了但项目里已经没有这个变体的 */
  unknownSelectedCount: number
}

/** 不能构建时返回原因，可以构建时返回 null */
export function buildBlockedReason(input: BuildGuardInput): string | null {
  /*
   * 不再因为「勾选还没写进数据库」而拦住构建。
   *
   * 勾选现在是乐观更新的，入队时带的是界面此刻的选择（主进程按它冻结目标），
   * 所以这个等待没有实际保护作用；反而让它成了「每勾一下按钮和提示都闪一下」的来源。
   */
  if (input.buildableVariantCount === 0) {
    if (input.queuedVariantCount > 0) {
      return '勾选的变体都已经在队列里了，等它们跑完再试'
    }
    if (input.unknownSelectedCount > 0) {
      return '勾选的变体已不在项目里，先刷新变体'
    }
    return '先勾选至少一个发布变体'
  }
  if (input.pendingProjectCount === 0) {
    return '勾选的变体都已经在队列里了，等它们跑完再试'
  }
  return null
}

/** 提示后缀：有多少变体会被跳过，让「按了没反应」不再发生 */
export function queuedExclusionHint(input: BuildGuardInput): string | null {
  if (input.queuedVariantCount === 0 || input.buildableVariantCount === 0) {
    return null
  }
  return `其中 ${input.queuedVariantCount} 个变体已在队列里，本次只追加其余`
}

/**
 * 未结束队列项占用的变体：项目 id → 变体名集合。
 *
 * 只看 pending / running 的项：项结束之后它的变体就自由了（可以再打一次）。
 * 参数用结构类型而不是 QueueItem，是为了测试里能直接喂几行最小数据。
 */
export function queuedVariantMap(
  items: Array<Pick<QueueItem, 'projectId' | 'state' | 'variants'>>
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const item of items) {
    if (item.state !== 'pending' && item.state !== 'running') {
      continue
    }
    const set = map.get(item.projectId) ?? new Set<string>()
    for (const name of item.variants) {
      set.add(name)
    }
    map.set(item.projectId, set)
  }
  return map
}

/**
 * 真正要入队的目标：剔除已占用的变体，只带还没在队列里的那些。
 *
 * 变体在这里就定下来随入队一起传出去，主进程不再回读数据库里的勾选 ——
 * 「界面显示什么就构建什么」因此是**结构上的保证**，而不是「希望写入先落盘」的时序保证。
 * 主进程还会再按同一规则筛一次：界面可能停在旧数据上。
 */
export function enqueueTargets(
  projects: Array<{ id: string }>,
  resolutions: Map<string, { buildable: string[] }>,
  queuedVariants: Map<string, Set<string>>
): EnqueueTarget[] {
  const targets: EnqueueTarget[] = []
  for (const project of projects) {
    const buildable = resolutions.get(project.id)?.buildable ?? []
    const occupied = queuedVariants.get(project.id) ?? EMPTY_VARIANTS
    const fresh = buildable.filter((name) => !occupied.has(name))
    if (fresh.length === 0) {
      continue
    }
    targets.push({ projectId: project.id, variants: fresh })
  }
  return targets
}

/** 空集合常量：避免每个项目都新建一个 Set */
export const EMPTY_VARIANTS: ReadonlySet<string> = new Set<string>()

/** 主进程正在忙时的统一措辞：两条链路说的是同一件事，不该有两种说法 */
export const BUSY_REASON = '正在处理上一个操作…'

export interface CurrentProjectGuardInput {
  /** 这个项目这次会真正入队的变体数（按钮上的 N） */
  variantCount: number
  busy: boolean
  /** 勾选的变体里有多少已被队列占用 */
  queuedVariantCount: number
  /** 环境检查里第一条 error 的文案；null = 没发现问题 */
  envIssue: string | null
}

/**
 * 「构建当前项目」这个动作不能点时，原因是什么。
 *
 * 与 buildBlockedReason 放在一起，是因为它们背后是**同一个动作的两个入口**：
 * 顶栏那个打的是抽屉里当前项目的变体，勾选表那个打的是跨项目勾选。
 * 两处的原因文案必须同源，否则会出现「同一个按钮在两处说两种理由」。
 *
 * 唯一有意保留的差别是环境检查：它只对「当前项目」生效 —— 跨项目入口没有为每个项目
 * 跑一遍环境自检的代价预算，所以它不拦。这条差别写在界面上（勾选表的按钮旁边），
 * 而不是靠用户去猜为什么两处禁用条件不同。
 */
export function currentProjectBlockedReason(input: CurrentProjectGuardInput): string | null {
  if (input.busy) {
    return BUSY_REASON
  }
  if (input.envIssue) {
    return `构建环境有问题：${input.envIssue}`
  }
  if (input.variantCount === 0) {
    if (input.queuedVariantCount > 0) {
      return '勾选的变体都已经在队列里了，等它们跑完再试'
    }
    return '先在发布变体里勾选至少一个'
  }
  return null
}
