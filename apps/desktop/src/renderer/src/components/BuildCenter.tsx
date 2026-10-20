import { useState } from 'react'
import type { Project } from '@shared/types/project'
import { BuildPicker } from './BuildPicker'
import { SummaryPanel } from './SummaryPanel'

type CenterView = 'plan' | 'done'

/** 上次看的是哪个视图：出包的人常常盯着「已构建的」，每次切回来都要再点一次很烦 */
const VIEW_STORAGE_KEY = 'abr.buildCenterView'

function readStoredView(): CenterView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'done' ? 'done' : 'plan'
  } catch {
    return 'plan'
  }
}

function rememberView(view: CenterView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view)
  } catch {
    // 存不下就算了：这次会话里视图仍然是对的
  }
}

interface BuildCenterProps {
  projects: Project[]
  busyProjectId: string | null
  /** 已在队列里的变体：项目 id → 变体名集合 */
  queuedVariants: Map<string, Set<string>>
  /** 会被构建的变体总数（按钮上的 N） */
  buildableVariantCount: number
  /** 未勾选 / 正在保存 / 都在队列里 时给出的原因 */
  blockedReason: string | null
  /** 有项目因已在队列中而被跳过的提示 */
  queuedHint: string | null
  /** 统一输出目录；null 表示还没读到设置 */
  outputRoot: string | null
  /** 入队前的廉价预检结果：项目 id → 缺项（只提示，不拦） */
  preflightIssues: Record<string, string[]>
  onSetVariants: (projectId: string, names: string[]) => void
  onRefreshVariants: (projectId: string) => void
  onBuild: () => void
}

/**
 * 构建中心：同一张卡片里两个视图。
 *
 * 「要构建的」是意图（永远指现在），「已构建的」是事实（可以按最近一批或全部历史看），
 * 两者的时间语义不同，所以分成两个视图而不是合并成一张表。
 *
 * 折叠状态与当前视图都放在这一层：视图切换是条件渲染，状态留在 BuildPicker 里的话
 * 每次切走再回来都会重置（折叠白折、视图白点）。
 */
export function BuildCenter({
  projects,
  busyProjectId,
  queuedVariants,
  buildableVariantCount,
  blockedReason,
  queuedHint,
  outputRoot,
  preflightIssues,
  onSetVariants,
  onRefreshVariants,
  onBuild
}: BuildCenterProps): React.JSX.Element {
  const [view, setView] = useState<CenterView>(readStoredView)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const switchView = (next: CenterView): void => {
    setView(next)
    rememberView(next)
  }

  const toggleCollapsed = (projectId: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }

  return (
    <section className="card-shell">
      <div className="card-core card-core--pad build-center">
        <header className="build-center__head">
          <h2 className="build-center__title">构建中心</h2>
          <div className="summary__scope" role="group" aria-label="构建中心的视图">
            <button
              type="button"
              className={
                view === 'plan' ? 'btn-outline summary__scope-btn' : 'btn-ghost summary__scope-btn'
              }
              aria-pressed={view === 'plan'}
              onClick={() => {
                switchView('plan')
              }}
            >
              要构建的
            </button>
            <button
              type="button"
              className={
                view === 'done' ? 'btn-outline summary__scope-btn' : 'btn-ghost summary__scope-btn'
              }
              aria-pressed={view === 'done'}
              onClick={() => {
                switchView('done')
              }}
            >
              已构建的
            </button>
          </div>
        </header>

        {view === 'plan' ? (
          <BuildPicker
            projects={projects}
            busyProjectId={busyProjectId}
            queuedVariants={queuedVariants}
            buildableVariantCount={buildableVariantCount}
            blockedReason={blockedReason}
            queuedHint={queuedHint}
            outputRoot={outputRoot}
            preflightIssues={preflightIssues}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSetVariants={onSetVariants}
            onRefreshVariants={onRefreshVariants}
            onBuild={onBuild}
          />
        ) : (
          <SummaryPanel />
        )}
      </div>
    </section>
  )
}
