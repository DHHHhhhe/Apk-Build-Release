import { useMemo } from 'react'
import { CHANGELOG_MARKDOWN } from '../lib/changelog-source'
import { parseChangelog } from '../lib/changelog'
import type { ChangelogRelease } from '../lib/changelog'

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
      {props.release.sections.map((section) => (
        <div key={section.title} className="changelog__section">
          <h5 className="changelog__section-title">{section.title}</h5>
          <ul className="changelog__items">
            {section.items.map((item, index) => (
              // 条目内容作 key 就够：同一版里不会有两行一模一样的说明
              <li key={`${index}-${item}`}>{renderInline(item)}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/**
 * 更新记录列表（放在设置里的一个折叠块中，默认收起，保持对话框紧凑）。
 *
 * 打开之后：最新一版摊开、旧版本折在「更早的版本」里 —— 这份文件只会越来越长，
 * 而点进来的人通常只想看这次改了什么。
 */
export function ChangelogList(): React.JSX.Element {
  const releases = useMemo(() => parseChangelog(CHANGELOG_MARKDOWN), [])
  const [latest, ...older] = releases

  if (!latest) {
    return <p className="app-muted">更新记录为空。</p>
  }

  return (
    <div className="changelog">
      <Release release={latest} highlight />
      {older.length > 0 ? (
        <details className="changelog__older">
          <summary>更早的版本（{older.length}）</summary>
          {older.map((release) => (
            <Release key={release.version} release={release} highlight={false} />
          ))}
        </details>
      ) : null}
    </div>
  )
}
