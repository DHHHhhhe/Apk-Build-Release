import { useState } from 'react'
import { Check, Copy, FolderOpen, RefreshCw } from 'lucide-react'
import type { SummaryArtifact, SummaryScope } from '@shared/types/build'
import { useBuildSummary } from '../hooks/useBuildSummary'
import { formatBytes } from '../lib/bytes'
import { formatDateTime, formatDurationMs } from '../lib/duration'

const STATE_LABEL: Record<SummaryArtifact['state'], string> = {
  running: '构建中',
  success: '成功',
  failed: '失败',
  canceled: '已取消'
}

function stateBadgeClass(state: SummaryArtifact['state']): string {
  if (state === 'success') {
    return 'badge badge--success'
  }
  if (state === 'failed') {
    return 'badge badge--destructive'
  }
  if (state === 'running') {
    return 'badge badge--info'
  }
  return 'badge badge--muted'
}

/** 复制给同事的产物路径清单：一行一个完整路径 */
export function buildPathList(
  groups: Array<{ projectName: string; artifacts: SummaryArtifact[] }>
): string {
  const lines: string[] = []
  for (const group of groups) {
    for (const artifact of group.artifacts) {
      if (artifact.apkPath) {
        lines.push(artifact.apkPath)
      }
    }
  }
  return lines.join('\n')
}

/**
 * 结果汇总：一次批量（或全部历史）出了哪些包、成没成、多大、签没签名。
 * 构建记录是逐个项目看的，这里给一个跨项目的总览。
 */
export function SummaryPanel(): React.JSX.Element {
  const { summary, scope, loading, error, setScope, refresh } = useBuildSummary()
  const [copied, setCopied] = useState(false)

  const totals = summary?.totals
  const hasArtifacts = (totals?.apkCount ?? 0) > 0
  const pathList = summary ? buildPathList(summary.groups) : ''

  const copyPaths = async (): Promise<void> => {
    const result = await window.api.app.copyText(pathList)
    if (result.success) {
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
      }, 2000)
    }
  }

  return (
    <div className="summary">
      <header className="summary__head">
        <span className="summary__scope-label">看的范围</span>
          <div className="summary__scope" role="group" aria-label="汇总范围">
            <button
              type="button"
              className={scope === 'latest' ? 'btn-outline summary__scope-btn' : 'btn-ghost summary__scope-btn'}
              aria-pressed={scope === 'latest'}
              onClick={() => {
                setScope('latest')
              }}
            >
              最近一批
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'btn-outline summary__scope-btn' : 'btn-ghost summary__scope-btn'}
              aria-pressed={scope === 'all'}
              onClick={() => {
                setScope('all')
              }}
            >
              全部记录
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={refresh}
            disabled={loading}
            aria-label="刷新汇总"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!hasArtifacts}
            onClick={() => {
              void window.api.settings.openPath(summary?.outputRoot ?? '')
            }}
          >
            <FolderOpen size={14} aria-hidden="true" />
            打开输出目录
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={pathList === ''}
            onClick={() => {
              void copyPaths()
            }}
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? '已复制' : '复制路径'}
          </button>
        </header>

        {error ? (
          <p className="app-error" role="status" aria-live="polite">
            {error}
          </p>
        ) : null}

        {totals ? (
          <ul className="summary__metrics">
            <li>
              <span className="summary__metric-value tabular">{totals.projects}</span>
              <span className="summary__metric-label">项目</span>
            </li>
            <li>
              <span className="summary__metric-value tabular">{totals.variants}</span>
              <span className="summary__metric-label">变体</span>
            </li>
            <li>
              <span className="summary__metric-value tabular summary__metric-value--ok">
                {totals.success}
              </span>
              <span className="summary__metric-label">成功</span>
            </li>
            <li>
              <span className="summary__metric-value tabular summary__metric-value--bad">
                {totals.failed}
              </span>
              <span className="summary__metric-label">失败</span>
            </li>
            {totals.canceled > 0 ? (
              <li>
                <span className="summary__metric-value tabular">{totals.canceled}</span>
                <span className="summary__metric-label">已取消</span>
              </li>
            ) : null}
            <li>
              <span className="summary__metric-value tabular">{formatDurationMs(totals.durationMs)}</span>
              <span className="summary__metric-label">构建耗时</span>
            </li>
            <li>
              <span className="summary__metric-value tabular">{totals.apkCount}</span>
              <span className="summary__metric-label">产物个数</span>
            </li>
            <li>
              <span className="summary__metric-value tabular">{formatBytes(totals.apkBytes)}</span>
              <span className="summary__metric-label">产物总大小</span>
            </li>
          </ul>
        ) : null}

        {totals && totals.unsignedCount > 0 ? (
          <p className="summary__notice">
            有 {totals.unsignedCount} 个产物未签名或签名无效，不能直接安装 —— 工具只标注，不代签。
          </p>
        ) : null}

        {loading && !summary ? (
          <p className="summary__empty">读取中…</p>
        ) : summary && summary.groups.length === 0 ? (
          <p className="summary__empty">
            {scope === 'latest'
              ? '还没有跑完的构建。跑一批之后这里会汇总出这一批的产物。'
              : '还没有任何构建记录。'}
          </p>
        ) : null}

        {summary?.groups.map((group) => (
          <div key={group.projectId} className="summary__group">
            <div className="summary__group-head">
              <span className="summary__group-name">{group.projectName}</span>
              <span className="summary__group-path tabular" title={group.projectPath}>
                {group.projectPath}
              </span>
            </div>
            <ul className="summary__rows">
              {group.artifacts.map((artifact) => (
                <li key={artifact.variant} className="summary__row">
                  <span className="summary__row-variant tabular">{artifact.variant}</span>
                  <span className={stateBadgeClass(artifact.state)}>{STATE_LABEL[artifact.state]}</span>
                  <span className="summary__row-file tabular" title={artifact.apkPath ?? ''}>
                    {artifact.apkName ?? (artifact.state === 'success' ? '（未定位到产物）' : '—')}
                  </span>
                  <span className="summary__row-size tabular">
                    {artifact.apkMissing ? '文件已被移走' : artifact.apkBytes > 0 ? formatBytes(artifact.apkBytes) : '—'}
                  </span>
                  <span className="summary__row-signed">
                    {artifact.signed === true ? (
                      <span className="badge badge--success">已签名</span>
                    ) : artifact.signed === false ? (
                      <span className="badge badge--warning">未签名</span>
                    ) : (
                      <span className="badge badge--muted">未验证</span>
                    )}
                  </span>
                  <span className="summary__row-time tabular">
                    {artifact.durationMs !== null ? formatDurationMs(artifact.durationMs) : '—'}
                    {artifact.finishedAt ? ` · ${formatDateTime(artifact.finishedAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {group.artifacts.some((artifact) => artifact.failureHint) ? (
              <ul className="summary__failures">
                {group.artifacts
                  .filter((artifact) => artifact.failureHint)
                  .map((artifact) => (
                    <li key={`${artifact.variant}-hint`}>
                      {artifact.variant}：{artifact.failureHint}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ))}
    </div>
  )
}
