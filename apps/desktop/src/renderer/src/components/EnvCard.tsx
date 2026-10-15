import { RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import type { EnvItemState, EnvProbeItem, EnvProbeResult } from '@shared/types/env'
import { envStateBadgeClass } from '../lib/state-badge'

const STATE_LABEL: Record<EnvItemState, string> = {
  ok: '就绪',
  warn: '注意',
  error: '缺失'
}



function EnvRow({ item }: { item: EnvProbeItem }): React.JSX.Element {
  return (
    <li className="env-card__row">
      <div className="env-card__row-head">
        <span className="env-card__label">{item.label}</span>
        <span className={envStateBadgeClass(item.state)}>{STATE_LABEL[item.state]}</span>
      </div>
      {item.value ? <p className="env-card__value tabular">{item.value}</p> : null}
      {item.detail ? <p className="env-card__detail">{item.detail}</p> : null}
      {item.source ? <p className="env-card__source">来源：{item.source}</p> : null}
    </li>
  )
}

/**
 * 环境自检卡片：纯展示。
 * 探测由上层按「当前选中项目」发起，卡片不再自己收路径输入 —— 免得用户以为填了就能加项目。
 */
export function EnvCard({
  result,
  loading,
  error,
  projectPath,
  onRefresh
}: {
  result: EnvProbeResult | null
  loading: boolean
  error: string | null
  /** 当前探测的是哪个项目，让用户知道这张卡在看谁 */
  projectPath: string | null
  onRefresh: () => void
}): React.JSX.Element {
  const hasBlocking = result?.items.some((item) => item.state === 'error') ?? false

  return (
    <section className="card-shell">
      <div className="card-core card-core--pad env-card">
        <header className="env-card__head">
          <h3 className="env-card__title">构建环境</h3>
          <span className={hasBlocking ? 'badge badge--destructive' : 'badge badge--success'}>
            {hasBlocking ? '有缺失项' : '可用'}
          </span>
          {projectPath ? (
            <span className="env-card__scope tabular" title={projectPath}>
              按 {projectPath} 探测
            </span>
          ) : null}
          <Button
            variant="ghost"
            className="env-card__refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} aria-hidden="true" />
            {loading ? '探测中' : '重新探测'}
          </Button>
        </header>

        {error ? (
          <p className="env-card__error" role="status" aria-live="polite">
            {error}
          </p>
        ) : null}

        {result && result.items.length > 0 ? (
          <ul className="env-card__list">
            {result.items.map((item) => (
              <EnvRow key={item.id} item={item} />
            ))}
          </ul>
        ) : null}

        {result && result.warnings.length > 0 ? (
          <ul className="env-card__warnings" role="status" aria-live="polite">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
