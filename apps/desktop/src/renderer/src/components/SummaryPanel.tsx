import { useMemo, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Check, Copy, FolderOpen, RefreshCw, Search } from 'lucide-react'
import type { SummaryArtifact } from '@shared/types/build'
import { useBuildSummary } from '../hooks/useBuildSummary'
import { formatBytes } from '../lib/bytes'
import { formatDateTime, formatDurationMs } from '../lib/duration'
import { dirnameOf } from '../lib/path-display'
import { openPathOrToast } from '../lib/open-path'
import { buildStateBadgeClass } from '../lib/state-badge'

const STATE_LABEL: Record<SummaryArtifact['state'], string> = {
  running: '构建中',
  success: '成功',
  failed: '失败',
  canceled: '已取消'
}



/**
 * 复制给同事的产物清单：制表符分隔，粘进表格就是一张可筛选的表。
 *
 * 以前这里只拼路径 —— 交付时要的是「哪个包、多大、签没签名、什么版本」，
 * 光有路径还得再回去逐个查。数据本来就在 summary 里。
 */
export function buildArtifactList(
  groups: Array<{ projectName: string; artifacts: SummaryArtifact[] }>
): string {
  const header = [
    '项目',
    '变体',
    '状态',
    '文件名',
    '大小',
    '签名',
    'applicationId',
    '版本',
    '完成时间',
    '路径'
  ]
  const lines = [header.join('\t')]
  for (const group of groups) {
    for (const artifact of group.artifacts) {
      lines.push(
        [
          group.projectName,
          artifact.variant,
          STATE_LABEL[artifact.state],
          artifact.apkName ?? '',
          artifact.apkBytes > 0 ? formatBytes(artifact.apkBytes) : '',
          artifact.signed === true ? '已签名' : artifact.signed === false ? '未签名' : '未验证',
          artifact.applicationId ?? '',
          artifact.versionName ?? '',
          artifact.finishedAt ? formatDateTime(artifact.finishedAt) : '',
          artifact.apkPath ?? ''
        ].join('\t')
      )
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
  /** 记录量上来之后，逐行找包很费眼；筛选是纯前端过滤，不动主进程的查询 */
  const [keyword, setKeyword] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | SummaryArtifact['state']>('all')

  const totals = summary?.totals
  const hasArtifacts = (totals?.apkCount ?? 0) > 0
  const artifactList = summary ? buildArtifactList(summary.groups) : ''

  const visibleGroups = useMemo(() => {
    if (!summary) {
      return []
    }
    const needle = keyword.trim().toLowerCase()
    return summary.groups
      .map((group) => ({
        ...group,
        artifacts: group.artifacts.filter((artifact) => {
          if (stateFilter !== 'all' && artifact.state !== stateFilter) {
            return false
          }
          if (needle === '') {
            return true
          }
          return [artifact.variant, artifact.apkName ?? '', group.projectName, artifact.applicationId ?? '']
            .some((value) => value.toLowerCase().includes(needle))
        })
      }))
      .filter((group) => group.artifacts.length > 0)
  }, [summary, keyword, stateFilter])

  const copyPaths = async (): Promise<void> => {
    const result = await window.api.app.copyText(artifactList)
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
          <Button
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            aria-label="刷新汇总"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </Button>
          <label className="summary__filter">
            <Search size={14} aria-hidden="true" />
            <input
              className="input summary__filter-input"
              value={keyword}
              placeholder="筛变体 / 文件名"
              aria-label="筛选产物"
              onChange={(event) => {
                setKeyword(event.target.value)
              }}
            />
          </label>
          <select
            className="input summary__filter-select"
            value={stateFilter}
            aria-label="按状态筛选"
            onChange={(event) => {
              setStateFilter(event.target.value as 'all' | SummaryArtifact['state'])
            }}
          >
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="failed">失败</option>
            <option value="canceled">已取消</option>
          </select>
          <Button
            variant="ghost"
            disabled={!hasArtifacts}
            onClick={() => {
              void openPathOrToast(summary?.outputRoot ?? '', '输出目录')
            }}
          >
            <FolderOpen size={14} aria-hidden="true" />
            打开输出目录
          </Button>
          <Button
            variant="ghost"
            disabled={artifactList === ''}
            title="复制成制表符分隔的清单，可直接粘进表格"
            onClick={() => {
              void copyPaths()
            }}
          >
            {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {copied ? '已复制' : '复制清单'}
          </Button>
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

        {summary && summary.groups.length > 0 && visibleGroups.length === 0 ? (
          <p className="summary__empty">没有匹配的产物。换个关键字，或把状态改回「全部状态」。</p>
        ) : null}

        {visibleGroups.map((group) => (
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
                  <span className={buildStateBadgeClass(artifact.state)}>{STATE_LABEL[artifact.state]}</span>
                  <span className="summary__row-file tabular" title={artifact.apkPath ?? ''}>
                    {artifact.apkName ?? (artifact.state === 'success' ? '（未定位到产物）' : '—')}
                    {/* 交付前要核对版本号：数据本来就在契约里，构建记录也显示，只有这里以前没有 */}
                    {artifact.applicationId || artifact.versionName ? (
                      <span className="summary__row-meta">
                        {artifact.applicationId ?? ''}
                        {artifact.versionName ? ` · v${artifact.versionName}` : ''}
                      </span>
                    ) : null}
                  </span>
                  <span className="summary__row-size tabular">
                    {artifact.apkMissing ? '文件已被移走' : artifact.apkBytes > 0 ? formatBytes(artifact.apkBytes) : '—'}
                  </span>
                  <span className="summary__row-signed">
                    {artifact.signed === true ? (
                      <Badge variant="success">已签名</Badge>
                    ) : artifact.signed === false ? (
                      <Badge variant="warning">未签名</Badge>
                    ) : (
                      <Badge variant="muted">未验证</Badge>
                    )}
                  </span>
                  <span className="summary__row-time tabular">
                    {artifact.durationMs !== null ? formatDurationMs(artifact.durationMs) : '—'}
                    {artifact.finishedAt ? ` · ${formatDateTime(artifact.finishedAt)}` : ''}
                  </span>
                  {/* 出包后最常做的是「去拿这个包」：以前整行 0 个按钮，只能开整个输出目录再自己翻 */}
                  <span className="summary__row-actions">
                    {artifact.apkPath ? (
                      <Button
                        variant="ghost"
                        className="summary__row-open"
                        title={dirnameOf(artifact.apkPath)}
                        aria-label={`打开 ${artifact.variant} 的产物目录`}
                        onClick={() => {
                          void openPathOrToast(dirnameOf(artifact.apkPath ?? ''), '产物目录')
                        }}
                      >
                        <FolderOpen size={14} aria-hidden="true" />
                      </Button>
                    ) : null}
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

