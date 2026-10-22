import { useMemo } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ChevronDown, ChevronRight, TerminalSquare } from 'lucide-react'
import {
  filterVariantsForPackaging,
  isPackagingFallback,
  isReleaseBuildType,
  PACKAGING_FALLBACK_NOTE
} from '@shared/lib/variants'
import { resolveOutputFolderName } from '@shared/lib/output-folder'
import type { Project, ProjectVariant } from '@shared/types/project'
import { EMPTY_VARIANTS } from '../lib/build-guard'
import { variantBadgeVisibility } from '../lib/variant-badges'
import { pickerCountText } from '../lib/queue-row'

interface BuildPickerProps {
  projects: Project[]
  /** 正在解析变体的那个项目；只禁用它的那一行，别把整张表锁住 */
  busyProjectId: string | null
  /** 已在队列里的变体：项目 id → 变体名集合。这些变体不能重复入队 */
  queuedVariants: Map<string, Set<string>>
  /** 会被构建的变体总数，就是按钮上的 N */
  buildableVariantCount: number
  blockedReason: string | null
  queuedHint: string | null
  /** 统一输出目录；null 表示还没读到设置，这时不显示归档路径 */
  outputRoot: string | null
  /** 入队前的廉价预检结果：项目 id → 一眼能看出的缺项（只提示，不拦） */
  preflightIssues: Record<string, string[]>
  /** 折叠状态由构建中心持有：视图切走再回来不该重置 */
  collapsed: Set<string>
  onToggleCollapsed: (projectId: string) => void
  onSetVariants: (projectId: string, names: string[]) => void
  onRefreshVariants: (projectId: string) => void
}

/**
 * 当前参与出包的变体：与主进程入队共用同一条规则（只出 release；项目没有 release 时回退全部）。
 * 界面不再提供绕开这条规则的入口。
 */
function visibleVariantsOf(project: Project): ProjectVariant[] {
  return filterVariantsForPackaging(project.variants)
}

/** 按 flavor（渠道）分组，保持原有顺序；没有 flavor 的归到一个空 key 下 */
function groupByFlavor(variants: ProjectVariant[]): Array<{ flavor: string; variants: ProjectVariant[] }> {
  const map = new Map<string, ProjectVariant[]>()
  for (const variant of variants) {
    const key = variant.flavor ?? ''
    const list = map.get(key)
    if (list) {
      list.push(variant)
    } else {
      map.set(key, [variant])
    }
  }
  return Array.from(map.entries()).map(([flavor, list]) => ({ flavor, variants: list }))
}

/**
 * 跨项目的勾选表：在一处看见并修改「这次要打哪些包」，然后一次入队。
 *
 * 快捷操作的作用范围只限于可见变体：看不见的勾选不会被「全选 / 清空 / 只选某类型」悄悄丢掉。
 */
export function BuildPicker({
  projects,
  busyProjectId,
  queuedVariants,
  buildableVariantCount,
  blockedReason,
  queuedHint,
  outputRoot,
  preflightIssues,
  collapsed,
  onToggleCollapsed,
  onSetVariants,
  onRefreshVariants,
}: BuildPickerProps): React.JSX.Element {

  /*
   * 归档文件夹名按别名优先，而别名是在抽屉里设的 —— 勾选表这边以前完全看不到。
   * 同一个文件夹名被两个项目用上时，两边的产物会混进同一个目录，这件事必须当场说出来。
   */
  const folderNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of projects) {
      map.set(project.id, resolveOutputFolderName(project))
    }
    const seen = new Map<string, number>()
    for (const name of map.values()) {
      seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    return { byProject: map, duplicated: new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name)) }
  }, [projects])

  const selectedCount = projects.reduce(
    (total, project) => total + project.selectedVariants.length,
    0
  )
  // 全选按钮上的数字只数「还能入队」的：已在队列里的选上也构建不了
  const visibleCount = projects.reduce((total, project) => {
    const occupied = queuedVariants.get(project.id) ?? EMPTY_VARIANTS
    return total + visibleVariantsOf(project).filter((variant) => !occupied.has(variant.name)).length
  }, 0)

  /** 只加不减：全选不会把看不见的勾选抹掉，也不会选上已在队列里的变体 */
  const selectAllOf = (project: Project): void => {
    const occupied = queuedVariants.get(project.id) ?? EMPTY_VARIANTS
    const merged = new Set(project.selectedVariants)
    for (const variant of visibleVariantsOf(project)) {
      if (!occupied.has(variant.name)) {
        merged.add(variant.name)
      }
    }
    onSetVariants(project.id, Array.from(merged))
  }

  /** 勾/取消一个变体：单变体卡与多变体行共用同一份写入口 */
  const toggleVariantOf = (project: Project, name: string): void => {
    const next = new Set(project.selectedVariants)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    onSetVariants(project.id, Array.from(next))
  }

  const selectAll = (): void => {
    for (const project of projects) {
      selectAllOf(project)
    }
  }

  const clearAll = (): void => {
    for (const project of projects) {
      onSetVariants(project.id, [])
    }
  }

  /** 只选某个渠道（flavor）：保留看不见的勾选，只重排这个渠道的可见变体 */
  const onlyFlavorOf = (project: Project, flavor: string): void => {
    const visible = visibleVariantsOf(project)
    const visibleNames = new Set(visible.map((variant) => variant.name))
    const kept = project.selectedVariants.filter((name) => !visibleNames.has(name))
    const picked = visible.filter((variant) => (variant.flavor ?? '') === flavor).map((variant) => variant.name)
    onSetVariants(project.id, [...kept, ...picked])
  }

  const onlyBuildTypeOf = (project: Project, buildType: string): void => {
    // 保留隐藏的勾选，只重排可见的那部分
    const hidden = project.selectedVariants.filter(
      (name) => !visibleVariantsOf(project).some((variant) => variant.name === name)
    )
    const picked = visibleVariantsOf(project)
      .filter((variant) => variant.buildType === buildType)
      .map((variant) => variant.name)
    onSetVariants(project.id, [...hidden, ...picked])
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    /*
     * 只保留 Ctrl/Cmd+A 全选。
     *
     * Esc 以前在这里是「清空所有勾选」并且立即写库 —— 与「Esc = 关闭 / 取消」的通用语义相反，
     * 用户想关掉抽屉却把一整批勾选清掉了。清空仍然有按钮，不必占用这个键。
     */
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
    }
  }

  if (projects.length === 0) {
    return <p className="build-picker__empty">还没有项目。先在上面添加一个 Android 项目。</p>
  }

  return (
    <div className="build-picker" onKeyDown={handleKeyDown}>
      <div className="build-picker__bar">
        <span
          className="build-picker__count tabular"
          role="status"
          aria-live="polite"
          title="已选包含不在列表里的历史勾选，所以可能与待入队数不同"
        >
          {pickerCountText(selectedCount, buildableVariantCount)}
        </span>
        <Button
          variant="ghost"
          disabled={visibleCount === 0}
          onClick={selectAll}
        >
          全选全部项目（{visibleCount} 个变体）
        </Button>
        <Button variant="ghost" disabled={selectedCount === 0} onClick={clearAll}>
          清空
        </Button>
      </div>

      <ul className="build-picker__groups">
        {projects.map((project) => {
          const visible = visibleVariantsOf(project)
          const selected = new Set(project.selectedVariants)
          const isCollapsed = collapsed.has(project.id)
          // 这个项目里已经被队列占住的变体：逐行禁用，并在项目头上给出数量
          const occupied = queuedVariants.get(project.id) ?? EMPTY_VARIANTS
          const queuedCount = visible.filter((variant) => occupied.has(variant.name)).length
          // 忙只锁这一个项目：别的项目在解析变体时，本项目的勾选照样能改
          const projectBusy = busyProjectId === project.id
          const buildTypes = Array.from(new Set(visible.map((variant) => variant.buildType)))
          const fallback = isPackagingFallback(project.variants)
          const badgeVisibility = variantBadgeVisibility(visible, { forceBuildType: fallback })
          const flavorGroups = groupByFlavor(visible)
          const folderName = folderNames.byProject.get(project.id) ?? project.name
          const folderClash = folderNames.duplicated.has(folderName)
          const issues = preflightIssues[project.id] ?? []

          /*
           * 单变体项目压成一行。
           *
           * 只有一个变体时，「全选本项目（1 个变体）」与「清空」跟那个勾选框完全等价（伪操作），
           * 折叠也没有意义（只有一行）。
           * 异常形态一律不压缩 —— 无变体、预检缺项、打包回退、已折叠，
           * 它们多出来的那一行本身就是提示，压掉就丢信息了。
           *
           * 注意：**不要**把「这个项目正在写库」也算进来。勾选一下就会置忙，
           * 那会让卡片在 41px 与展开态之间来回跳一次 —— 用户看到的就是「画面闪动」。
           * 忙只用来禁用勾选框（见 renderRow 的 disabled）。
           */
          const onlyVariant = visible.length === 1 ? visible[0] : undefined
          const compactSingle =
            onlyVariant !== undefined &&
            flavorGroups.length <= 1 &&
            issues.length === 0 &&
            !fallback &&
            !isCollapsed

          if (compactSingle && onlyVariant !== undefined) {
            const onlyOccupied = occupied.has(onlyVariant.name)
            return (
              <li
                key={project.id}
                className="summary__group build-picker__group build-picker__group--single"
                title={project.path}
              >
                <label className="build-picker__label build-picker__label--single">
                  <input
                    type="checkbox"
                    checked={selected.has(onlyVariant.name)}
                    disabled={onlyOccupied}
                    onChange={() => {
                      toggleVariantOf(project, onlyVariant.name)
                    }}
                  />
                  <span className="summary__group-name">{project.name}</span>
                  <span className="build-picker__variant tabular" title={onlyVariant.name}>
                    {onlyVariant.name}
                  </span>
                  <Badge
                    variant={folderClash ? 'warning' : 'muted'}
                    title={
                      folderClash
                        ? `有多个项目都用「${folderName}」这个归档名，产物会混在同一个目录里`
                        : outputRoot
                          ? `产物会归档到 ${outputRoot}\\${folderName}`
                          : `产物会归档到「${folderName}」文件夹`
                    }
                  >
                    {folderClash ? `归档名冲突：${folderName}` : `归档：${folderName}`}
                  </Badge>
                  {onlyOccupied ? (
                    <Badge variant="info" title="这个变体已经在队列里，等它跑完才能再入队">
                      队列中
                    </Badge>
                  ) : null}
                </label>
              </li>
            )
          }

          /** 一行变体：分组与不分组两种排布共用 */
          const renderRow = (variant: ProjectVariant): React.JSX.Element => {
            // 已在队列里的变体禁用：勾上再入队会被主进程剔掉，看着像按了没反应
            const isOccupied = occupied.has(variant.name)
            return (
              <li key={variant.name} className="build-picker__row">
                <label className="build-picker__label">
                  <input
                    type="checkbox"
                    checked={selected.has(variant.name)}
                    disabled={projectBusy || isOccupied}
                    onChange={() => {
                      toggleVariantOf(project, variant.name)
                    }}
                  />
                  <span className="build-picker__variant tabular" title={variant.name}>
                    {variant.name}
                  </span>
                </label>
                {isOccupied ? (
                  <Badge variant="info" title="这个变体已经在队列里，等它跑完才能再入队">
                    队列中
                  </Badge>
                ) : null}
                {badgeVisibility.flavor && variant.flavor ? (
                  <Badge variant="muted">{variant.flavor}</Badge>
                ) : null}
                {badgeVisibility.buildType ? (
                  <Badge variant="muted">{variant.buildType}</Badge>
                ) : null}
                {!isReleaseBuildType(variant.buildType) ? (
                  <Badge variant="warning" title="非 release 变体通常用调试密钥签名，不能上架">
                    不能上架
                  </Badge>
                ) : null}
              </li>
            )
          }

          return (
            <li key={project.id} className="summary__group build-picker__group">
              <div className="summary__group-head build-picker__group-head">
                <Button
                  variant="ghost"
                  className="build-picker__collapse"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? `展开 ${project.name}` : `收起 ${project.name}`}
                  onClick={() => {
                    onToggleCollapsed(project.id)
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                </Button>
                <span className="summary__group-name">{project.name}</span>
                <span className="summary__group-path tabular" title={project.path}>
                  {project.path}
                </span>
                {/* 别名决定归档目录：勾选时就得看见，而不是等出包后去抽屉里查 */}
                <Badge
                  variant={folderClash ? 'warning' : 'muted'}
                  title={
                    folderClash
                      ? `有多个项目都用「${folderName}」这个归档名，产物会混在同一个目录里`
                      : outputRoot
                        ? `产物会归档到 ${outputRoot}\\${folderName}`
                        : `产物会归档到「${folderName}」文件夹`
                  }
                >
                  {folderClash ? `归档名冲突：${folderName}` : `归档：${folderName}`}
                </Badge>
                {queuedCount > 0 ? (
                  <Badge variant="info" title="这些变体已经在队列里，本次不会重复入队">
                    队列中 {queuedCount}
                  </Badge>
                ) : null}
                {project.variants.length === 0 ? (
                  <Badge variant="muted">无变体</Badge>
                ) : null}
                <span className="build-picker__group-actions">
                  <Button
                    variant="ghost"
                    disabled={projectBusy || visible.length - queuedCount === 0}
                    onClick={() => {
                      selectAllOf(project)
                    }}
                  >
                    全选本项目（{visible.length - queuedCount} 个变体）
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={projectBusy || project.selectedVariants.length === 0}
                    onClick={() => {
                      onSetVariants(project.id, [])
                    }}
                  >
                    清空
                  </Button>
                  {/* 只有一种 buildType 时这个按钮是恒等操作（「只选 release」= 全选），不显示 */}
                  {buildTypes.length > 1
                    ? buildTypes.map((buildType) => (
                        <Button
                          key={buildType}
                          variant="ghost"
                          disabled={projectBusy}
                          onClick={() => {
                            onlyBuildTypeOf(project, buildType)
                          }}
                        >
                          只选 {buildType}
                        </Button>
                      ))
                    : null}
                </span>
              </div>

              {/* 预检只提示不拦：用户可能就想先把队排上，边修环境边等 */}
              {issues.length > 0 ? (
                <p className="build-picker__preflight" role="status" aria-live="polite">
                  入队前检查：{issues.join('；')}
                </p>
              ) : null}

              {isCollapsed ? null : project.variants.length === 0 ? (
                <p className="build-picker__hint">
                  没解析出变体。点右侧「用 Gradle 解析」跑一遍真实配置，或者先在项目详情里刷新变体。
                  <Button
                    variant="ghost"
                    className="build-picker__inline-action"
                    disabled={projectBusy}
                    onClick={() => {
                      onRefreshVariants(project.id)
                    }}
                  >
                    <TerminalSquare size={14} aria-hidden="true" />
                    {projectBusy ? 'Gradle 解析中…' : '用 Gradle 解析（较慢）'}
                  </Button>
                </p>
              ) : (
                <>
                  {/* 回退必须说出来：这些不是发布变体，包打出来也上不了架 */}
                  {fallback ? (
                    <p className="build-picker__fallback" role="status" aria-live="polite">
                      {PACKAGING_FALLBACK_NOTE}
                    </p>
                  ) : null}
                  {/*
                   * 多渠道项目按 flavor 分组：出包的单位是渠道，
                   * 而以前只有一个「只选 release」的维度，选某个渠道得逐个勾。
                   */}
                  {flavorGroups.length > 1 ? (
                    <ul className="build-picker__flavors">
                      {flavorGroups.map((group) => (
                        <li key={group.flavor || '__none'} className="build-picker__flavor">
                          <div className="build-picker__flavor-head">
                            <span className="build-picker__flavor-name">
                              {group.flavor === '' ? '（无渠道）' : group.flavor}
                            </span>
                            <span className="tabular build-picker__flavor-count">
                              {group.variants.length} 个变体
                            </span>
                            <Button
                              variant="ghost"
                              className="build-picker__inline-action"
                              disabled={projectBusy}
                              onClick={() => {
                                onlyFlavorOf(project, group.flavor)
                              }}
                            >
                              只选本渠道
                            </Button>
                          </div>
                          <ul className="build-picker__rows">{group.variants.map(renderRow)}</ul>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="build-picker__rows">{visible.map(renderRow)}</ul>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>

      {/*
       * 底部不再放构建按钮：它和顶栏那个是同一个动作、同一个标签，看起来像两个平行入口。
       * 动作只留顶栏一处（常驻，滚到哪都在）；这里只留说明文字——
       * 「为什么现在不能构建」和「有几个变体已在队列里」是列表本身的上下文，顶栏放不下。
       */}
      {blockedReason !== null || queuedHint !== null ? (
        <div className="build-picker__foot">
          {blockedReason ? (
            <span className="build-picker__reason" role="status" aria-live="polite">
              {blockedReason}
            </span>
          ) : null}
          {queuedHint ? <span className="build-picker__reason">{queuedHint}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
