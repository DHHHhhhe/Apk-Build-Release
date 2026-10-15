import { useState } from 'react'
import { Button } from './ui/button'
import type { Project } from '@shared/types/project'
import { BuildPicker } from './BuildPicker'
import { SummaryPanel } from './SummaryPanel'

type CenterView = 'plan' | 'done'

interface BuildCenterProps {
  projects: Project[]
  busyProjectId: string | null
  queuedProjectIds: Set<string>
  /** 会被构建的变体总数（按钮上的 N） */
  buildableVariantCount: number
  /** 未勾选 / 正在保存 / 都在队列里 时给出的原因 */
  blockedReason: string | null
  /** 有项目因已在队列中而被跳过时的提示 */
  queuedHint: string | null
  onSetVariants: (projectId: string, names: string[]) => void
  onRefreshVariants: (projectId: string) => void
  onBuild: () => void
}

/**
 * 构建中心：同一张卡片里两个视图。
 *
 * 「要构建的」是意图（永远指现在），「已构建的」是事实（可以按最近一批或全部历史看），
 * 两者的时间语义不同，所以分成两个视图而不是合并成一张表。
 */
export function BuildCenter({
  projects,
  busyProjectId,
  queuedProjectIds,
  buildableVariantCount,
  blockedReason,
  queuedHint,
  onSetVariants,
  onRefreshVariants,
  onBuild
}: BuildCenterProps): React.JSX.Element {
  const [view, setView] = useState<CenterView>('plan')

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
                setView('plan')
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
                setView('done')
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
            queuedProjectIds={queuedProjectIds}
            buildableVariantCount={buildableVariantCount}
            blockedReason={blockedReason}
            queuedHint={queuedHint}
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
