import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Sparkles, X } from 'lucide-react'
import { PROJECT_REPO_URL } from '@shared/constants/links'
import { Dialog } from './ui/dialog'
import { CHANGELOG_MARKDOWN } from '../lib/changelog-source'
import { parseChangelog } from '../lib/changelog'
// 分类 → 标签样式的对照表放在 lib 里，测试会拿 CHANGELOG 里真实出现的分类去核对它
import { SECTION_TAGS } from '../lib/changelog-tags'

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
/**
 * GitHub 标记。
 *
 * lucide 从 1.x 起不再带品牌图标（`Github` 已移除），所以这里内联官方 mark 的路径 ——
 * 只为一个小图标引一个品牌图标包不划算。
 */
function GithubMark({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

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
    <Dialog open={open} labelledBy="changelog-title" className="dialog--changelog" onClose={onClose}>
        <header className="dialog__head">
          <span className="dialog__icon">
            <Sparkles size={16} aria-hidden="true" />
          </span>
          <h2 className="dialog__title" id="changelog-title">
            更新记录
          </h2>
          {/*
           * 跳开源库。用 <a target="_blank">：主进程已经用 setWindowOpenHandler 把外部链接
           * 交给系统浏览器（index.ts），所以这里不需要再走 IPC。
           */}
          <a
            className="dialog__title-link"
            href={PROJECT_REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 上查看源码"
            title="在 GitHub 上查看源码"
          >
            <GithubMark />
          </a>
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
                    {isCurrent ? <Badge variant="muted" className="changelog__current">当前版本</Badge> : null}
                  </header>

                  {entry.sections.map((section, sectionIndex) => {
                    const style = SECTION_TAGS[section.title]
                    return (
                      <div key={`${section.title}-${sectionIndex}`} className="changelog__section">
                        {section.title ? (
                          style ? (
                            <span className={`badge badge--${style.variant} changelog__tag`}>
                              <style.Icon size={12} aria-hidden="true" />
                              {section.title}
                            </span>
                          ) : (
                            <Badge variant="muted" className="changelog__tag">{section.title}</Badge>
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
              <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => step(-1)}>
                上一页
              </Button>
              <span className="changelog__pager-page tabular">
                {safePage + 1} / {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => step(1)}>
                下一页
              </Button>
            </div>
          </footer>
        ) : null}
    </Dialog>
  )
}

