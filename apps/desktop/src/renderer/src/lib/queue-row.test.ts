import { describe, expect, it } from 'vitest'
import {
  WAIT_DISPLAY_MIN_MS,
  isSingleVariantItem,
  itemWaitText,
  pickerCountText,
  projectStatusBadge,
  variantTimingText
} from './queue-row'

const NOW = 10_000_000

describe('isSingleVariantItem', () => {
  it('声明了一个变体就是单变体项，哪怕它还没开跑（runs 为空）', () => {
    expect(isSingleVariantItem({ variants: ['freeRelease'] })).toBe(true)
  })

  it('两个及以上变体交给子行去表达', () => {
    expect(isSingleVariantItem({ variants: ['freeRelease', 'paidRelease'] })).toBe(false)
    expect(isSingleVariantItem({ variants: [] })).toBe(false)
  })
})

describe('variantTimingText', () => {
  const base = {
    state: 'running' as const,
    startedAt: NOW - 21_000,
    durationMs: null,
    estimatedMs: 300_000,
    waitMs: 4_000,
    showEstimate: true,
    now: NOW
  }

  it('运行中给「等待 · 构建 · 预计」三段', () => {
    expect(variantTimingText(base)).toBe('等待 4s · 构建 21s · 预计 5m00s')
  })

  it('等待不足 1s 时不提「等待」', () => {
    expect(variantTimingText({ ...base, waitMs: 999 })).toBe('构建 21s · 预计 5m00s')
    expect(variantTimingText({ ...base, waitMs: 1_000 })).toBe('等待 1s · 构建 21s · 预计 5m00s')
    expect(WAIT_DISPLAY_MIN_MS).toBe(1_000)
  })

  it('超出预估时如实说出来，而不是让读数停在预计值', () => {
    expect(variantTimingText({ ...base, startedAt: NOW - 370_000 })).toBe(
      '等待 4s · 构建 6m10s · 已超出预计 5m00s'
    )
  })

  it('关掉预估时整段「预计」都不出现', () => {
    expect(variantTimingText({ ...base, showEstimate: false })).toBe('等待 4s · 构建 21s')
  })

  it('没有历史样本时不编一个预计', () => {
    expect(variantTimingText({ ...base, estimatedMs: null })).toBe('等待 4s · 构建 21s')
  })

  it('已结束只给耗时，不再重复等待', () => {
    expect(
      variantTimingText({
        ...base,
        state: 'success',
        durationMs: 180_000,
        startedAt: NOW - 200_000
      })
    ).toBe('耗时 3m00s')
  })

  it('还没开始给「未开始」', () => {
    expect(
      variantTimingText({
        ...base,
        state: 'running',
        startedAt: null,
        durationMs: null,
        waitMs: null
      })
    ).toBe('未开始')
  })

  it('等待为 null 时不猜测', () => {
    expect(variantTimingText({ ...base, waitMs: null })).toBe('构建 21s · 预计 5m00s')
  })
})

describe('itemWaitText', () => {
  it('不足 1s 不提「等待」：刚入队不该显示「等待 0s」', () => {
    expect(itemWaitText(0)).toBe('—')
    expect(itemWaitText(999)).toBe('—')
  })

  it('1s 起给「等待 x」', () => {
    expect(itemWaitText(1_000)).toBe('等待 1s')
    expect(itemWaitText(65_000)).toBe('等待 1m05s')
  })
})

describe('pickerCountText', () => {
  it('两个数相等时只说一个数', () => {
    expect(pickerCountText(8, 8)).toBe('已选 8')
  })

  it('不等时把差额说出来', () => {
    expect(pickerCountText(8, 6)).toBe('已选 8 · 待入队 6')
  })

  it('一个都入不了队时不说「待入队 0」这种负向噪声', () => {
    expect(pickerCountText(8, 0)).toBe('已选 8')
  })
})

describe('projectStatusBadge', () => {
  it('在队列里就只说这一件事', () => {
    expect(projectStatusBadge({ variantCount: 3, selectedCount: 3, inQueue: true })).toEqual({
      label: '队列中',
      tone: 'info'
    })
  })

  it('单变体项目只给一个有信息量的徽章', () => {
    expect(projectStatusBadge({ variantCount: 1, selectedCount: 1, inQueue: false })).toEqual({
      label: '已选',
      tone: 'success'
    })
    expect(projectStatusBadge({ variantCount: 1, selectedCount: 0, inQueue: false })).toEqual({
      label: '未选',
      tone: 'muted'
    })
  })

  it('多变体项目给比例', () => {
    expect(projectStatusBadge({ variantCount: 4, selectedCount: 2, inQueue: false })).toEqual({
      label: '已选 2/4',
      tone: 'success'
    })
    expect(projectStatusBadge({ variantCount: 4, selectedCount: 0, inQueue: false })).toEqual({
      label: '已选 0/4',
      tone: 'muted'
    })
  })

  it('勾选里留有已改名/删除的历史名字时夹紧，不出现「已选 5/3」', () => {
    expect(projectStatusBadge({ variantCount: 3, selectedCount: 5, inQueue: false })).toEqual({
      label: '已选 3/3',
      tone: 'success'
    })
  })
})
