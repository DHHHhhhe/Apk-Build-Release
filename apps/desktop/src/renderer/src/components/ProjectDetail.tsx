import { RefreshCw, TerminalSquare } from 'lucide-react'
import { filterVariantsForPackaging } from '@shared/lib/variants'
import type { Project } from '@shared/types/project'
import type { ProjectBusyKind } from '../hooks/useProjects'

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
  showDebug,
  onToggleShowDebug,
  onToggleVariant,
  onSetVariants,
  onRefreshVariants
}: {
  project: Project
  busyKind: ProjectBusyKind | null
  /** 这个项目当前在队列里跑着 */
  building: boolean
  /** 正在跑的那条队列项用的变体快照 */
  queuedVariants: string[] | null
  /** 是否显示 debug 变体（状态在 App 层，因为构建时也要用同一条规则） */
  showDebug: boolean
  onToggleShowDebug: () => void
  onToggleVariant: (variantName: string) => void
  onSetVariants: (names: string[]) => void
  onRefreshVariants: (force: boolean) => void
}): React.JSX.Element {
  const selected = new Set(project.selectedVariants)
  const badge = sourceBadge(project)
  const busy = busyKind !== null

  // 打包工具默认只列发布变体：debug 包用调试密钥签名、不能对外发布，混在列表里只是噪音。
  // 但项目要是连 release 变体都没有，就把全部列出来，不能让用户面对一个空列表。
  const releaseOnly = filterVariantsForPackaging(project.variants)
  const visibleVariants = showDebug ? project.variants : releaseOnly
  const hiddenDebugCount = project.variants.length - releaseOnly.length
  const mixedBuildTypes = new Set(visibleVariants.map((variant) => variant.buildType)).size > 1

  const buildTypes = Array.from(new Set(visibleVariants.map((variant) => variant.buildType)))

  const namesOfBuildType = (buildType: string): string[] =>
    visibleVariants.filter((variant) => variant.buildType === buildType).map((variant) => variant.name)

  return (
    <section className="card-shell">
      <div className="card-core card-core--pad project-detail">
        <header className="project-detail__head">
          <div>
            <h2 className="project-detail__title">{project.name}</h2>
            <p className="project-detail__path tabular">{project.path}</p>
          </div>
          <span className={badge.className}>{badge.label}</span>
          <button
            type="button"
            className="btn-outline"
            title="只读项目里的 Gradle 配置文件，毫秒级出结果"
            onClick={() => {
              onRefreshVariants(false)
            }}
            disabled={busy}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {busyKind === 'static' ? '解析中…' : '刷新变体'}
          </button>
          <button
            type="button"
            className="btn-ghost"
            title="真的跑一遍 Gradle 配置阶段，慢的时候要几分钟，但结果最准"
            onClick={() => {
              onRefreshVariants(true)
            }}
            disabled={busy}
          >
            <TerminalSquare size={16} aria-hidden="true" />
            {busyKind === 'gradle' ? 'Gradle 解析中…' : '用 Gradle 解析（较慢）'}
          </button>
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

        <h3 className="project-detail__section">选择要构建的变体</h3>
        {project.variants.length === 0 ? (
          <p className="project-detail__empty">
            没解析出变体。先用「刷新变体」读配置文件；如果项目是用变量动态生成 flavor 的，点「用 Gradle
            解析（较慢）」让它按真实配置算一遍。
          </p>
        ) : (
          <>
            {hiddenDebugCount > 0 || showDebug ? (
              <p className="project-detail__variant-note">
                {showDebug
                  ? '正在显示 debug 变体：debug 包用调试密钥签名，不能对外发布，正常出包不用勾它们。'
                  : `已隐藏 ${hiddenDebugCount} 个 debug 变体（调试用，不对外发布）。release 变体通常没有配签名，工具只标注签名状态、不代签。`}
                <button
                  type="button"
                  className="btn-ghost project-detail__variant-toggle"
                  onClick={onToggleShowDebug}
                >
                  {showDebug ? '只看发布变体' : '显示 debug 变体'}
                </button>
              </p>
            ) : null}

            <div className="variant-quick">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || selected.size === visibleVariants.length}
                onClick={() => {
                  onSetVariants(visibleVariants.map((variant) => variant.name))
                }}
              >
                全选
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={busy || selected.size === 0}
                onClick={() => {
                  onSetVariants([])
                }}
              >
                清空
              </button>
              {buildTypes.map((buildType) => (
                <button
                  key={buildType}
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    onSetVariants(namesOfBuildType(buildType))
                  }}
                >
                  只选 {buildType}
                </button>
              ))}
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
                    {variant.flavor ? <span className="badge badge--muted">{variant.flavor}</span> : null}
                    <span className="badge badge--muted">{variant.buildType}</span>
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
