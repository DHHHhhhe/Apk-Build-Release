import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, Moon, Plus, Sparkles, Wrench } from 'lucide-react'
import { CHANGELOG_MARKDOWN } from '../lib/changelog-source'
import { parseChangelog } from '../lib/changelog'
import type { ChangelogRelease } from '../lib/changelog'

/** 一页几个版本。版本数会一直涨，一次全渲染既滚不完、也定位不到当前版本 */
const PAGE_SIZE = 5

/**
 * 分类的语义色与图标。
 *
 * 一屏里扫读时，四个灰色小标题分不出哪几类是重点；加上颜色与图形之后，
 * 「这版有没有修东西」一眼就能看出来。认不出的分类退回中性样式，内容照常显示、绝不丢。
 */
const SECTION_STYLES: Record<string, { tone: string; Icon: typeof Wrench }> = {
  新增: { tone: 'add', Icon: Plus },
  优化: { tone: 'improve', Icon: Sparkles },
  变更: { tone: 'improve', Icon: Sparkles },
  修复: { tone: 'fix', Icon: Wrench },
  说明: { tone: 'note', Icon: Info },
  已知: { tone: 'note', Icon: Moon }
}

function sectionStyle(title: string): { tone: string; Icon: typeof Wrench } {
  return SECTION_STYLES[title] ?? { tone: 'neutral', Icon: Info }
}

/**
 * 把条目里的行内标记渲染出来。
 *
 * 走 JSX 而不是 dangerouslySetInnerHTML：CHANGELOG 是仓库里的文件，但没理由为它开一个注入面。
 * 只认两种标记（粗体与行内代码），认不出的原样输出。
 */
function renderInline(text: string): React.ReactNode {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter((part) => part !== '')
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>
      }
      return <span key={index}>{part}</span>
    })
}

function Release(props: { release: ChangelogRelease; highlight: boolean }): React.JSX.Element {
  return (
    <section className={props.highlight ? 'changelog__release changelog__release--latest' : 'changelog__release'}>
      <h4 className="changelog__version">
        <span className="tabular">{props.release.version}</span>
        <span className="changelog__date tabular">{props.release.date}</span>
      </h4>
      {props.release.sections.map((section) => {
        const { tone, Icon } = sectionStyle(section.title)
        return (
          <div key={section.title} className="changelog__section">
            <h5 className={`changelog__section-title changelog__section-title--${tone}`}>
              <Icon size={12} aria-hidden="true" />
              {section.title}
            </h5>
            <ul className="changelog__items">
              {section.items.map((item, index) => (
                // 条目内容作 key 就够：同一版里不会有两行一模一样的说明
                <li key={`${index}-${item}`}>{renderInline(item)}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function pageOfVersion(releases: ChangelogRelease[], version: string | undefined): number {
  if (!version) {
    return 0
  }
  const index = releases.findIndex((release) => release.version === version)
  return index < 0 ? 0 : Math.floor(index / PAGE_SIZE)
}

/**
 * 更新记录（分页）。
 *
 * 打开时自动定位到**当前运行的版本**那一页：想知道「这版改了什么」时，用户要找的就是它。
 */
export function ChangelogList({ currentVersion }: { currentVersion?: string }): React.JSX.Element {
  const releases = useMemo(() => parseChangelog(CHANGELOG_MARKDOWN), [])
  const [page, setPage] = useState(() => pageOfVersion(releases, currentVersion))
  const topRef = useRef<HTMLDivElement | null>(null)

  if (releases.length === 0) {
    return <p className="app-muted">更新记录为空。</p>
  }

  const pageCount = Math.max(1, Math.ceil(releases.length / PAGE_SIZE))
  const current = Math.min(Math.max(page, 0), pageCount - 1)
  const from = current * PAGE_SIZE
  const visible = releases.slice(from, from + PAGE_SIZE)

  const go = (delta: number): void => {
    setPage(Math.min(Math.max(current + delta, 0), pageCount - 1))
    // 翻页后回到列表顶部，不停在新一页的中间
    topRef.current?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="changelog">
      <div ref={topRef} />
      {visible.map((release, index) => (
        // 只有当前版本那一版给底色，翻页后跟着走
        <Release
          key={release.version}
          release={release}
          highlight={release.version === currentVersion || (index === 0 && from === 0 && !currentVersion)}
        />
      ))}

      {pageCount > 1 ? (
        <nav className="changelog__pager" aria-label="更新记录翻页">
          <span className="changelog__pager-info tabular">
            第 {from + 1}–{Math.min(from + PAGE_SIZE, releases.length)} 个 / 共 {releases.length} 个
          </span>
          <span className="changelog__pager-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={current === 0}
              aria-label="上一页"
              onClick={() => {
                go(-1)
              }}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              上一页
            </button>
            <span className="changelog__pager-page tabular">
              {current + 1}/{pageCount}
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={current >= pageCount - 1}
              aria-label="下一页"
              onClick={() => {
                go(1)
              }}
            >
              下一页
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </span>
        </nav>
      ) : null}
    </div>
  )
}
