import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { RefreshCw, TerminalSquare } from 'lucide-react'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'
import type { ProjectBusyKind } from '../hooks/useProjects'
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
  queuedVariants,
  onToggleVariant,
  onSetVariants,
  onRefreshVariants,
  onSetAlias
}: {
  project: Project
  busyKind: ProjectBusyKind | null
  /** 这个项目当前在队列里跑着 */
  building: boolean
  /** 正在跑的那条队列项用的变体快照 */
  queuedVariants: string[] | null
  onToggleVariant: (variantName: string) => void
  onSetVariants: (names: string[]) => void
  onRefreshVariants: (force: boolean) => void
  /** 保存别名；null 表示清空，回到用项目名归档 */
  onSetAlias: (alias: string | null) => void
}): React.JSX.Element {
  const selected = new Set(project.selectedVariants)
  const badge = sourceBadge(project)
  const busy = busyKind !== null
  const [aliasDraft, setAliasDraft] = useState(project.alias ?? '')

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
  }

  // 只列发布变体；项目连 release 变体都没有时回退到全部，不能让用户面对空列表
  const visibleVariants = filterVariantsForPackaging(project.variants)
  const mixedBuildTypes = new Set(visibleVariants.map((variant) => variant.buildType)).size > 1
  const badgeVisibility = variantBadgeVisibility(visibleVariants)

  const buildTypes = Array.from(new Set(visibleVariants.map((variant) => variant.buildType)))
  const allVisibleSelected = visibleVariants.every((variant) => selected.has(variant.name))

  const namesOfBuildType = (buildType: string): string[] =>
    visibleVariants.filter((variant) => variant.buildType === buildType).map((variant) => variant.name)

  return (
    <section className="card-shell">
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
            </label>
          </div>
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
        </header>

        <dl className="project-detail__facts">
          <div>
            <dt>应用模块</dt>
            <dd className="tabular">{project.appModule ?? '未识别'}</dd>
          </div>
          <div>
            <dt>已选变体</dt>
            <dd className="tabular">{selected.size}</dd>
          </div>
        </dl>

        {building ? (
          <p className="project-detail__building" role="status" aria-live="polite">
            这个项目正在构建中，用的是入队时的 {queuedVariants?.length ?? 0} 个变体
            {queuedVariants && queuedVariants.length > 0 ? `（${queuedVariants.join('、')}）` : ''}
            。现在改选不会影响正在跑的这一项。
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
            <div className="variant-quick">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || allVisibleSelected}
                onClick={() => {
                  // 与构建中心一致：全选是**并集**，不会把看不见的勾选（旧的 debug 残留）抹掉
                  const merged = new Set(project.selectedVariants)
                  for (const variant of visibleVariants) {
                    merged.add(variant.name)
                  }
                  onSetVariants(Array.from(merged))
                }}
              >
                全选
              </button>
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
                    <button
                      key={buildType}
                      type="button"
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        // 同样只重排可见的那部分，保留看不见的勾选
                        const visibleNames = new Set(visibleVariants.map((variant) => variant.name))
                        const kept = project.selectedVariants.filter((name) => !visibleNames.has(name))
                        onSetVariants([...kept, ...namesOfBuildType(buildType)])
                      }}
                    >
                      只选 {buildType}
                    </button>
                  ))
                : null}
            </div>

            <ul className="variant-list">
              {visibleVariants.map((variant) => (
                <li key={variant.name} className="variant-list__item">
                  <label className="variant-list__label">
                    <input
                      type="checkbox"
                      checked={selected.has(variant.name)}
                      disabled={busy}
                      onChange={() => {
                        onToggleVariant(variant.name)
                      }}
                    />
                    <span className="variant-list__name tabular">{variant.name}</span>
                  </label>
                  <span className="variant-list__parts">
                    {badgeVisibility.flavor && variant.flavor ? (
                      <span className="badge badge--muted">{variant.flavor}</span>
                    ) : null}
                    {badgeVisibility.buildType ? (
                      <span className="badge badge--muted">{variant.buildType}</span>
                    ) : null}
                    {/* 列表里只有 release 时不必逐行重复，说明放在列表上方一次 */}
                    {mixedBuildTypes && variant.buildType === 'release' ? (
                      <span
                        className="badge badge--muted"
                        title="release 变体通常没有配签名，工具只标注签名状态、不代签"
                      >
                        通常未签名
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
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
