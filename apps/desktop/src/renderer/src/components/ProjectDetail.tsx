import { useEffect, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { RefreshCw, TerminalSquare } from 'lucide-react'
import {
  filterVariantsForPackaging,
  isPackagingFallback,
  isReleaseBuildType,
  PACKAGING_FALLBACK_NOTE
} from '@shared/lib/variants'
import { resolveOutputFolderName } from '@shared/lib/output-folder'
import type { Project } from '@shared/types/project'
import type { ProjectBusyKind } from '../hooks/useProjects'
import { joinDisplayPath } from '../lib/path-display'
import { variantBadgeVisibility } from '../lib/variant-badges'

/** 变体来源徽章：静态解析是正常默认路径，不该用警告色；只有真的缺项才提示 */
function sourceBadge(project: Project): { className: string; label: string } {
  if (project.variantsSource === 'gradle') {
    return { className: 'badge badge--success', label: 'Gradle 解析' }
  }
  if (project.limitations.length > 0) {
    return { className: 'badge badge--warning', label: '静态解析（可能缺项）' }
  }
  return { className: 'badge badge--muted', label: '静态解析' }
}

export function ProjectDetail({
  project,
  busyKind,
  building,
  occupiedVariants,
  outputRoot,
  onToggleVariant,
  onSetVariants,
  onRefreshVariants,
  onSetAlias
}: {
  project: Project
  busyKind: ProjectBusyKind | null
  /** 这个项目当前在队列里跑着 */
  building: boolean
  /** 已经在队列里的变体：不能再入队，勾选框禁用并标出来 */
  occupiedVariants: string[]
  /** 统一输出目录；null = 还没读到设置，这时不显示归档预览 */
  outputRoot: string | null
  onToggleVariant: (variantName: string) => void
  onSetVariants: (names: string[]) => void
  onRefreshVariants: (force: boolean) => void
  /** 保存别名；null 表示清空，回到用项目名归档 */
  onSetAlias: (alias: string | null) => void
}): React.JSX.Element {
  const selected = new Set(project.selectedVariants)
  /** 已在队列里的变体：勾选框禁用，否则按下去会被主进程剔除，看着像没反应 */
  const occupied = new Set(occupiedVariants)
  const badge = sourceBadge(project)
  const busy = busyKind !== null
  const [aliasDraft, setAliasDraft] = useState(project.alias ?? '')
  const [aliasSaved, setAliasSaved] = useState(false)

  // 切换项目时把草稿同步过来，否则会把上一个项目的别名显示成当前项目的
  useEffect(() => {
    setAliasDraft(project.alias ?? '')
  }, [project.id, project.alias])

  // 失焦或回车才提交：边打字边写库会把半截别名存进去
  const commitAlias = (): void => {
    const next = aliasDraft.trim()
    if (next === (project.alias ?? '')) {
      return
    }
    onSetAlias(next.length === 0 ? null : next)
    setAliasSaved(true)
  }

  // 「已保存」只闪一下：它是确认而不是状态，长期挂着反而让人以为还需要再保存一次
  useEffect(() => {
    if (!aliasSaved) {
      return
    }
    const timer = window.setTimeout(() => {
      setAliasSaved(false)
    }, 2000)
    return () => {
      window.clearTimeout(timer)
    }
  }, [aliasSaved])

  // 只列发布变体；项目连 release 变体都没有时回退到全部，不能让用户面对空列表
  const visibleVariants = filterVariantsForPackaging(project.variants)
  const fallback = isPackagingFallback(project.variants)
  const mixedBuildTypes = new Set(visibleVariants.map((variant) => variant.buildType)).size > 1
  // 回退时强制显示 buildType：那时列表里只有一种类型，不显示就等于把唯一的线索藏了
  const badgeVisibility = variantBadgeVisibility(visibleVariants, { forceBuildType: fallback })

  const buildTypes = Array.from(new Set(visibleVariants.map((variant) => variant.buildType)))
  // 「全选」只选还能入队的：已占用的变体选上也构建不了
  const selectableVisible = visibleVariants.filter((variant) => !occupied.has(variant.name))
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((variant) => selected.has(variant.name))

  // 别名改完还没提交时，预览要跟着草稿走：用户看到的就是「保存后会变成什么」
  const archiveFolder = resolveOutputFolderName({
    alias: aliasDraft.trim() === '' ? null : aliasDraft.trim(),
    name: project.name
  })
  const archivePath = outputRoot ? joinDisplayPath(outputRoot, archiveFolder) : null

  const namesOfBuildType = (buildType: string): string[] =>
    visibleVariants.filter((variant) => variant.buildType === buildType).map((variant) => variant.name)

  return (
    <section className="card-shell" data-drawer-section="variants">
      <div className="card-core card-core--pad project-detail">
        <header className="project-detail__head">
          <div>
            <h3 className="project-detail__title">{project.name}</h3>
            <p className="project-detail__path tabular">{project.path}</p>
            <label className="project-detail__alias">
              <span>别名</span>
              <input
                type="text"
                className="tabular"
                value={aliasDraft}
                maxLength={64}
                placeholder="留空则用项目名"
                title="产物归档到统一输出目录时，用它做文件夹名"
                onChange={(event) => {
                  setAliasDraft(event.target.value)
                }}
                onBlur={commitAlias}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
              />
              {aliasSaved ? (
                <span className="project-detail__alias-saved" role="status" aria-live="polite">
                  已保存
                </span>
              ) : null}
            </label>
            {archivePath ? (
              <p className="project-detail__archive tabular" title={archivePath}>
                产物会归档到 {archivePath}
              </p>
            ) : null}
          </div>
          {/*
           * 徽章与两个按钮包成一组：它们以前是 header 的直接子元素，标题块又高又宽，
           * 换行时徽章留在第一行、两个按钮被挤到第二行 —— 量出来徽章顶 181、按钮顶 295，
           * 看着就不齐。包成一组后要么整组在第一行，要么整组换下去，三个元素始终同一行。
           */}
          <div className="project-detail__actions">
            <span className={badge.className}>{badge.label}</span>
            <Button
              variant="outline"
              title="只读项目里的 Gradle 配置文件，毫秒级出结果"
              onClick={() => {
                onRefreshVariants(false)
              }}
              disabled={busy}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {busyKind === 'static' ? '解析中…' : '刷新变体'}
            </Button>
            <Button
              variant="ghost"
              title="真的跑一遍 Gradle 配置阶段，慢的时候要几分钟，但结果最准"
              onClick={() => {
                onRefreshVariants(true)
              }}
              disabled={busy}
            >
              <TerminalSquare size={16} aria-hidden="true" />
              {busyKind === 'gradle' ? 'Gradle 解析中…' : '用 Gradle 解析（较慢）'}
            </Button>
          </div>
        </header>

        <dl className="project-detail__facts">
          <div>
            <dt>应用模块</dt>
            <dd className="tabular">{project.appModule ?? '未识别'}</dd>
          </div>
          <div>
            <dt>已选变体</dt>
            <dd className="tabular" title="含不在当前列表里的历史勾选（例如被规则挡下的旧选择）">
              {selected.size}
            </dd>
          </div>
        </dl>

        {building ? (
          <p className="project-detail__building" role="status" aria-live="polite">
            这个项目正在构建中
            {occupied.size > 0 ? `，队列里的变体：${Array.from(occupied).join('、')}` : ''}
            。新勾选的变体会追加到队列，不影响已经在跑的那一项。
          </p>
        ) : null}

        <h4 className="project-detail__section">选择要构建的变体</h4>
        {project.variants.length === 0 ? (
          <p className="project-detail__empty">
            没解析出变体。先用「刷新变体」读配置文件；如果项目是用变量动态生成 flavor 的，点「用 Gradle
            解析（较慢）」让它按真实配置算一遍。
          </p>
        ) : (
          <>
            {/* 回退必须说出来：不然用户以为列表里的是发布变体，包打出来才知道是 debug */}
            {fallback ? (
              <p className="project-detail__fallback" role="status" aria-live="polite">
                {PACKAGING_FALLBACK_NOTE}
              </p>
            ) : null}

            <div className="variant-quick">
              <Button
                variant="ghost"
                disabled={busy || allVisibleSelected}
                onClick={() => {
                  // 与构建中心一致：全选是**并集**，不会把看不见的勾选（旧的 debug 残留）抹掉；
                  // 已在队列里的变体选不上，选上也会在入队时被剔除
                  const merged = new Set(project.selectedVariants)
                  for (const variant of selectableVisible) {
                    merged.add(variant.name)
                  }
                  onSetVariants(Array.from(merged))
                }}
              >
                全选
              </Button>
              <Button
                variant="ghost"
                disabled={busy || selected.size === 0}
                onClick={() => {
                  // 清空是名副其实的清空：连同看不见的残留一起清掉
                  onSetVariants([])
                }}
              >
                清空
              </Button>
              {/* 只选某类型：列表里只有一种 buildType 时这个按钮是恒等操作（比如「只选 release」= 全选），不显示 */}
              {mixedBuildTypes
                ? buildTypes.map((buildType) => (
                    <Button
                      key={buildType}
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        // 同样只重排可见的那部分，保留看不见的勾选
                        const visibleNames = new Set(visibleVariants.map((variant) => variant.name))
                        const kept = project.selectedVariants.filter((name) => !visibleNames.has(name))
                        onSetVariants([...kept, ...namesOfBuildType(buildType)])
                      }}
                    >
                      只选 {buildType}
                    </Button>
                  ))
                : null}
            </div>

            <ul className="variant-list">
              {visibleVariants.map((variant) => {
                const isOccupied = occupied.has(variant.name)
                return (
                  <li key={variant.name} className="variant-list__item">
                    <label className="variant-list__label">
                      <input
                        type="checkbox"
                        checked={selected.has(variant.name)}
                        // 已在队列里的变体禁用：勾上再入队会被剔除，不如直接不让勾
                        disabled={busy || isOccupied}
                        onChange={() => {
                          onToggleVariant(variant.name)
                        }}
                      />
                      <span className="variant-list__name tabular" title={variant.name}>
                        {variant.name}
                      </span>
                    </label>
                    <span className="variant-list__parts">
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
                      {/* 非 release 变体由调试密钥签名、不能上架：这是后果，不是分类，用警告色说清 */}
                      {!isReleaseBuildType(variant.buildType) ? (
                        <Badge variant="warning" title="非 release 变体通常用调试密钥签名，不能上架">
                          不能上架
                        </Badge>
                      ) : null}
                      {/* 列表里只有 release 时不必逐行重复，说明放在列表上方一次 */}
                      {mixedBuildTypes && variant.buildType === 'release' ? (
                        <Badge variant="muted"
                          title="release 变体通常没有配签名，工具只标注签名状态、不代签"
                        >
                          通常未签名
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {project.limitations.length > 0 ? (
          <ul className="project-detail__notes" role="status" aria-live="polite">
            {project.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
