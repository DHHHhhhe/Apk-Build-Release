import { useEffect, useMemo, useRef, useState } from 'react'
import { Info, Sparkles, TrendingUp, Wrench, X } from 'lucide-react'
import { CHANGELOG_MARKDOWN } from '../lib/changelog-source'
import { parseChangelog } from '../lib/changelog'

/**
 * 每种改动类型的标记。
 *
 * 分类标题原来是一行灰色小字，一屏里「新增」「修复」长得一模一样，扫读时分不出哪几类是重点。
 * 改成带色的小标签 —— 颜色只用语义色（见 DESIGN.md：状态色一律浅底 + 同色深字），不引入装饰色。
 *
 * 认不出的分类退回中性样式，仍然显示原文，不丢内容。
 */
const SECTION_STYLE: Record<string, { variant: string; Icon: typeof Sparkles }> = {
  新增: { variant: 'success', Icon: Sparkles },
  优化: { variant: 'info', Icon: TrendingUp },
  修复: { variant: 'warning', Icon: Wrench },
  说明: { variant: 'muted', Icon: Info }
}

/**
 * 每页几个版本。
 *
 * 对话框的滚动区是 52vh，一屏大约放得下两个版本，所以 5 个意味着「翻一页要滚两下」——
 * 再多就得滚很久才看得完一页，再少则翻页太频繁。
 */
const PAGE_SIZE = 5

/**
 * 更新记录。历次版本的改动说明，最新的在最前。
 *
 * 内容来自仓库根的 CHANGELOG.md，构建时被 `?raw` 内联进包 —— 所以**断网也能看**。
 * 不走 GitHub API 是有意的：这个工具常在内网分发，从外面拉一份列表未必拿得到，
 * 而「这版改了什么」恰恰是装不上网的那台机器更需要知道的事。
 *
 * 分页而不是一次全渲染：版本数是会一直涨的，一屏塞几十个既滚不完也定位不到；
 * 分页顺带压住了「模态里滚动，关掉再开忘了滚到哪」这个毛病。
 */
export function ChangelogDialog({
  open,
  currentVersion,
  onClose
}: {
  open: boolean
  currentVersion: string
  onClose: () => void
}): React.JSX.Element | null {
  // CHANGELOG 是构建期就定下来的常量，解析一次就够，不必跟着开合重算
  const entries = useMemo(() => parseChangelog(CHANGELOG_MARKDOWN), [])
  const [page, setPage] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  // 夹一下：CHANGELOG 变短时（比如换了包）不至于停在一个不存在的页上
  const safePage = Math.min(page, pageCount - 1)
  const visible = entries.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  /*
   * 每次打开都定位到当前版本那一页 —— 那是最可能想看的。
   * 也顺手把上一次翻到的页码清掉，否则关了再开还停在半年前的某页上。
   */
  useEffect(() => {
    if (!open) {
      return
    }
    const index = entries.findIndex((entry) => entry.version === currentVersion)
    setPage(index >= 0 ? Math.floor(index / PAGE_SIZE) : 0)
  }, [open, entries, currentVersion])

  useEffect(() => {
    if (!open) {
      return
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  /**
   * 翻页。
   *
   * 用函数式更新而不是 `setPage(safePage + 1)`：后者的 safePage 是这次渲染时的旧值，
   * 用户连点两下会都基于同一个旧值算，结果只前进一步。
   */
  const step = (delta: number): void => {
    setPage((current) => Math.min(Math.max(current + delta, 0), pageCount - 1))
    // 翻页后回到顶部，否则新一页会从中间开始显示
    listRef.current?.scrollTo({ top: 0 })
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog dialog--changelog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <header className="dialog__head">
          <span className="dialog__icon">
            <Sparkles size={16} aria-hidden="true" />
          </span>
          <h2 className="dialog__title" id="changelog-title">
            更新记录
          </h2>
          <button type="button" className="dialog__close" aria-label="关闭" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="dialog__body">
          <p className="dialog__hint">共 {entries.length} 个版本，最新的在最前。</p>

          {/* 滚动区收在 52vh：窗口最小能缩到 680px 高，再高一点标题栏和翻页条就会被挤出去 */}
          <div ref={listRef} className="changelog__scroll">
            {visible.map((entry) => {
              const isCurrent = entry.version === currentVersion
              return (
                <section key={entry.version} className="changelog__release">
                  <header className="changelog__release-head">
                    <h3 className="changelog__version">
                      v<span className="tabular">{entry.version}</span>
                    </h3>
                    <time className="changelog__date tabular">{entry.date}</time>
                    {isCurrent ? <span className="badge badge--muted changelog__current">当前版本</span> : null}
                  </header>

                  {entry.sections.map((section, sectionIndex) => {
                    const style = SECTION_STYLE[section.title]
                    return (
                      <div key={`${section.title}-${sectionIndex}`} className="changelog__section">
                        {section.title ? (
                          style ? (
                            <span className={`badge badge--${style.variant} changelog__tag`}>
                              <style.Icon size={12} aria-hidden="true" />
                              {section.title}
                            </span>
                          ) : (
                            <span className="badge badge--muted changelog__tag">{section.title}</span>
                          )
                        ) : null}
                        <ul className="changelog__items">
                          {section.items.map((item, itemIndex) => (
                            <li key={`${itemIndex}-${item.slice(0, 12)}`}>
                              <span className="changelog__dot" aria-hidden="true" />
                              <span className="changelog__text">{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>

        {/* 只有一页时不出现翻页条 —— 摆着两个永远点不动的按钮没有意义 */}
        {pageCount > 1 ? (
          <footer className="dialog__foot changelog__pager">
            <p className="changelog__pager-info tabular">
              第 {safePage * PAGE_SIZE + 1}–{Math.min(entries.length, (safePage + 1) * PAGE_SIZE)} 条，共{' '}
              {entries.length} 个版本
            </p>
            <div className="changelog__pager-actions">
              <button
                type="button"
                className="btn-outline"
                disabled={safePage === 0}
                onClick={() => {
                  step(-1)
                }}
              >
                上一页
              </button>
              <span className="changelog__pager-page tabular">
                {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="btn-outline"
                disabled={safePage >= pageCount - 1}
                onClick={() => {
                  step(1)
                }}
              >
                下一页
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
