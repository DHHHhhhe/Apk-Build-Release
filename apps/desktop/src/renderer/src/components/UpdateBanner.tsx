import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/button'
import { Download, RotateCw } from 'lucide-react'
import { useUpdate } from '../hooks/useUpdate'

interface NoteSection {
  title: string
  items: string[]
}

/**
 * 把更新内容拆成「标题 + 列表项」，而不是压成一坨纯文本。
 *
 * 两条更新源给的格式不一样：GitHub 那条给 HTML（atom feed 的 content），内网 generic 源
 * 给 `latest.yml` 里原样的 markdown。先统一成文本，再按 `### 标题` 切段、按 `- ` 收列表项 ——
 * 拍平成一段的话，分类标题和正文同字号同颜色，扫读时分不出「哪几类改动」。
 *
 * 认不出结构的行整行当一条，宁可朴素也不丢内容。
 * 用 DOMParser 而不是往临时元素里塞 innerHTML：解析出来的是游离文档，图片与事件属性都没有机会执行。
 */
function parseNotes(raw: string): NoteSection[] {
  if (!raw) {
    return []
  }
  let text = raw
  try {
    text = new DOMParser().parseFromString(raw, 'text/html').body.textContent ?? raw
  } catch {
    text = raw
  }

  const stripBold = (line: string): string => line.replace(/\*\*(.+?)\*\*/g, '$1').trim()

  const sections: NoteSection[] = []
  let current: NoteSection = { title: '', items: [] }

  const flush = (): void => {
    if (current.title !== '' || current.items.length > 0) {
      sections.push(current)
    }
    current = { title: '', items: [] }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      continue
    }
    const heading = /^#{1,6}\s*(.+)$/.exec(line)?.[1]
    if (heading) {
      flush()
      current.title = stripBold(heading)
      continue
    }
    const item = /^[-*]\s+(.+)$/.exec(line)?.[1]
    if (item) {
      current.items.push(stripBold(item))
      continue
    }
    current.items.push(stripBold(line))
  }
  flush()

  return sections
}

/**
 * 分类标题上色：新增用绿、修复用橙、其余用蓝。
 * 先让用户扫到「这一版有哪几类改动」，再决定要不要看细节。
 */
function noteVariant(title: string): string {
  if (/新增|功能|特性/.test(title)) {
    return 'success'
  }
  if (/修复|修正|问题/.test(title)) {
    return 'warning'
  }
  return 'info'
}

/**
 * 自动更新的提示条，浮在窗口右下角。
 *
 * 为什么不占内容区顶部：更新是异步事件，而用户多半正在出包流程里。摆在内容流里会把页面往下顶、
 * 把「构建中心」推走，可这件事并不需要立即处理 —— 放角落才不打断。
 *
 * 只有安装版才会真的出现（便携版与解压即用版没有安装目录）。三个阶段各有去处：
 *   available   —— 发现新版本，把「更新了什么」摆出来，下不下由用户点
 *   downloading —— 进度条
 *   downloaded  —— 「立即重启并更新」
 * 其余一律不占位置：「已经是最新」与「检查失败」只在用户自己点过「检查更新」之后用一句提示收尾。
 *
 * 点「稍后」只是把这一条收起来，主进程的状态不动 —— 左下角的「检查更新」会跟着阶段变成
 * 「下载 x.y.z」或「重启并安装」，从那里接着走。
 */
export function UpdateBanner({ queueBusy }: { queueBusy: boolean }): React.JSX.Element | null {
  const update = useUpdate()
  const [dismissed, setDismissed] = useState(false)
  const [starting, setStarting] = useState(false)
  const state = update.state

  // 又来一个新版本就重新露头：上一次的「稍后」不该把这一条也压住
  useEffect(() => {
    if (state?.phase === 'available') {
      setDismissed(false)
    }
  }, [state?.phase, state?.version])

  const noteSections = useMemo(
    () => (state?.phase === 'available' ? parseNotes(state.releaseNotes) : []),
    [state?.phase, state?.releaseNotes]
  )

  if (!state || dismissed) {
    return null
  }

  const offering = state.phase === 'available'
  const downloading = state.phase === 'downloading'
  const ready = state.phase === 'downloaded'
  if (!offering && !downloading && !ready) {
    return null
  }

  const startDownload = async (): Promise<void> => {
    setStarting(true)
    try {
      await update.download()
    } finally {
      // 主进程一开始下载就会把状态推成 downloading，这个按钮随即消失；
      // 万一没推（比如版本已被撤下），这里把按钮恢复成可点，别卡在「正在开始下载…」
      setStarting(false)
    }
  }

  const restart = (): void => {
    void update.install()
  }

  return (
    <div className="update-banner" data-slot="update-banner">
      <div className="update-banner__head">
        {downloading ? (
          <Download className="update-banner__icon" size={16} aria-hidden="true" />
        ) : (
          <RotateCw className="update-banner__icon" size={16} aria-hidden="true" />
        )}
        <div className="update-banner__body">
          <span>{state.message}</span>

          {downloading ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              aria-label="更新下载进度"
              className="update-banner__progress"
            >
              <div className="update-banner__progress-fill" style={{ width: `${state.percent}%` }} />
            </div>
          ) : null}

          {/* 更新内容：Release 正文写了才有，没写就整块不出现 */}
          {noteSections.length > 0 ? (
            <div className="update-notes" data-slot="update-notes">
              {noteSections.map((section, sectionIndex) => (
                <div key={`${section.title}-${sectionIndex}`} className="update-notes__section">
                  {section.title !== '' ? (
                    <span className={`badge badge--${noteVariant(section.title)} update-notes__tag`}>
                      {section.title}
                    </span>
                  ) : null}
                  {section.items.length > 0 ? (
                    <ul className="update-notes__items">
                      {section.items.map((item, itemIndex) => (
                        <li key={itemIndex}>
                          {/* 用小圆点而不是「• 」字符：换行时悬挂缩进不会错位 */}
                          <span className="update-notes__dot" aria-hidden="true" />
                          <span className="update-notes__text">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {ready ? (
            <span className="update-banner__hint">也可以先接着用，下次关窗口时会自己装上。</span>
          ) : null}
        </div>
      </div>

      {offering ? (
        <div className="update-banner__actions">
          <button type="button" className="btn-primary" disabled={starting} onClick={() => void startDownload()}>
            {starting ? '正在开始下载…' : '下载并更新'}
          </button>
          <Button
            variant="ghost"
            onClick={() => {
              setDismissed(true)
            }}
          >
            稍后
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div className="update-banner__actions">
          <button
            type="button"
            className="btn-primary"
            disabled={queueBusy}
            title={queueBusy ? '有构建任务在跑，重启会把它掐掉' : undefined}
            onClick={() => {
              if (queueBusy) {
                return
              }
              restart()
            }}
          >
            立即重启并更新
          </button>
          <Button
            variant="ghost"
            onClick={() => {
              setDismissed(true)
            }}
          >
            稍后
          </Button>
        </div>
      ) : null}
    </div>
  )
}
