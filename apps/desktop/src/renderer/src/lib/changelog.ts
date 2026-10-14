/**
 * CHANGELOG.md 的解析。
 *
 * 界面上的「更新记录」读的是**打进包里的** CHANGELOG（构建时 `?raw` 内联），
 * 不走 GitHub API：这个工具常在内网分发，从外面拉列表未必拿得到，
 * 而「这版改了什么」恰恰是装不上网的那台机器更需要知道的事。
 *
 * 格式沿用 Keep a Changelog：`## 版本 - 日期` 打头，下面按 `### 分类` 分组。
 * 结构写死在解析器里，所以手改 CHANGELOG 时**不要动标题层级**。
 */
export interface ChangelogSection {
  /** 分类名，如「新增」「修复」 */
  title: string
  items: string[]
}

export interface ChangelogRelease {
  version: string
  /** `YYYY-MM-DD` */
  date: string
  sections: ChangelogSection[]
}

/** `## 0.3.3 - 2026-10-14` */
const RELEASE_HEADING = /^##\s+(\S+)\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/
/** `### 修复` */
const SECTION_HEADING = /^###\s+(.+?)\s*$/
/** `- 一条内容`（允许缩进的子条目） */
const ITEM = /^\s*-\s+(.+?)\s*$/

/**
 * 去掉条目里的行内标记。
 *
 * 正文不该露出 markdown 标记 —— 强调由排版承担（标题、缩进、圆点），
 * 而不是把 `**` 与反引号原样显示给用户。
 */
function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim()
}

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = []
  let current: ChangelogRelease | null = null
  let currentSection: ChangelogSection | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const release = RELEASE_HEADING.exec(line)
    if (release) {
      // 严格模式下捕获组是 string | undefined，得自己确认；日期已由正则限定格式
      const [, version, date] = release
      if (version && date) {
        current = { version, date, sections: [] }
        releases.push(current)
      }
      currentSection = null
      continue
    }

    // 版本小节之外的二级标题（比如文件头的说明）不参与解析
    if (/^##\s/.test(line)) {
      current = null
      currentSection = null
      continue
    }

    if (!current) {
      continue
    }

    const section = SECTION_HEADING.exec(line)
    if (section) {
      const title = section[1]
      if (title) {
        currentSection = { title, items: [] }
        current.sections.push(currentSection)
      }
      continue
    }

    const text = ITEM.exec(line)?.[1]
    if (text) {
      // 没有小标题的条目（版本小节直接以条目开头）也留着，归到一个「无标题」分类里
      if (!currentSection) {
        currentSection = { title: '', items: [] }
        current.sections.push(currentSection)
      }
      currentSection.items.push(stripInline(text))
    }
  }

  return releases
}

/** 取最新一版；文件为空或格式不对时返回 null */
export function latestRelease(releases: ChangelogRelease[]): ChangelogRelease | null {
  return releases[0] ?? null
}
