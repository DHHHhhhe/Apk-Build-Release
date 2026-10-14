import { describe, expect, it } from 'vitest'
import { latestRelease, parseChangelog } from './changelog'

const sample = `# 更新日志

本文件记录每个发布版本的重要变化。

格式沿用 Keep a Changelog。

> 界面上的「更新记录」读的就是这份文件，不要改标题层级。

## 0.4.0 - 2026-10-15

### 新增

- 更新记录直接读打进包里的 CHANGELOG
- 另一条新增

### 修复

- 某一处修好了

## 0.3.3 - 2026-10-14

### 修复

- 变体列表不再重复恒定的标签
`

describe('parseChangelog', () => {
  it('按顺序解析出版本、日期与分类', () => {
    expect(parseChangelog(sample)).toEqual([
      {
        version: '0.4.0',
        date: '2026-10-15',
        sections: [
          {
            title: '新增',
            items: ['更新记录直接读打进包里的 CHANGELOG', '另一条新增']
          },
          { title: '修复', items: ['某一处修好了'] }
        ]
      },
      { version: '0.3.3', date: '2026-10-14', sections: [{ title: '修复', items: ['变体列表不再重复恒定的标签'] }] }
    ])
  })

  it('文件头的说明不会被当成版本或条目', () => {
    const releases = parseChangelog(sample)
    expect(releases).toHaveLength(2)
    expect(releases.map((release) => release.version)).not.toContain('更新日志')
  })

  it('缩进的子条目也算一条，不会丢内容', () => {
    expect(parseChangelog('## 1.0.0 - 2026-01-01\n\n### 新增\n\n- 主条目\n  - 子条目\n')).toEqual([
      { version: '1.0.0', date: '2026-01-01', sections: [{ title: '新增', items: ['主条目', '子条目'] }] }
    ])
  })

  it('分类下没有条目时该分类仍然是空的，不抛异常', () => {
    expect(parseChangelog('## 1.0.0 - 2026-01-01\n\n### 说明\n\n## 0.9.0 - 2025-12-31\n')).toEqual([
      { version: '1.0.0', date: '2026-01-01', sections: [{ title: '说明', items: [] }] },
      { version: '0.9.0', date: '2025-12-31', sections: [] }
    ])
  })

  it('标题日期格式不对时整个版本被跳过，而不是解析出一堆垃圾', () => {
    const releases = parseChangelog(
      '## 没日期\n\n### 新增\n\n- x\n\n## 1.0.0 - 2026-01-01\n\n### 新增\n\n- y\n'
    )
    expect(releases.map((release) => release.version)).toEqual(['1.0.0'])
  })

  it('空文件返回空数组', () => {
    expect(parseChangelog('')).toEqual([])
  })
})

describe('latestRelease', () => {
  it('取第一个版本', () => {
    expect(latestRelease(parseChangelog(sample))).toMatchObject({ version: '0.4.0' })
  })

  it('没有版本时返回 null', () => {
    expect(latestRelease([])).toBeNull()
  })
})
