import { describe, expect, it } from 'vitest'
import { elapsedMs, formatClock, formatDateTime, formatDurationMs } from './duration'

describe('formatDurationMs', () => {
  it('不到一分钟显示秒', () => {
    expect(formatDurationMs(0)).toBe('0s')
    expect(formatDurationMs(8200)).toBe('8s')
    expect(formatDurationMs(59_400)).toBe('59s')
  })

  it('分钟档补零到两位，位数不跳', () => {
    expect(formatDurationMs(60_000)).toBe('1m00s')
    expect(formatDurationMs(218_000)).toBe('3m38s')
    expect(formatDurationMs(3_605_000)).toBe('1h00m05s')
  })

  it('小时档把分钟秒都补到两位', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h00m00s')
    expect(formatDurationMs(7_863_000)).toBe('2h11m03s')
  })

  it('没值或非法值给占位符而不是 NaN', () => {
    expect(formatDurationMs(null)).toBe('—')
    expect(formatDurationMs(Number.NaN)).toBe('—')
    expect(formatDurationMs(-1)).toBe('—')
  })
})

describe('formatClock / formatDateTime', () => {
  it('时刻补零到 HH:mm:ss', () => {
    const timestamp = new Date(2026, 9, 13, 9, 5, 7).getTime()
    expect(formatClock(timestamp)).toBe('09:05:07')
  })

  it('日期时刻是 M-D HH:mm', () => {
    const timestamp = new Date(2026, 9, 13, 19, 12, 34).getTime()
    expect(formatDateTime(timestamp)).toBe('10-13 19:12')
  })
})

describe('elapsedMs', () => {
  it('跑完取 finishedAt，跑着取当前时间', () => {
    expect(elapsedMs({ startedAt: 1000, finishedAt: 4000 }, 9999)).toBe(3000)
    expect(elapsedMs({ startedAt: 1000, finishedAt: null }, 4000)).toBe(3000)
  })

  it('时钟回拨时不出现负数', () => {
    expect(elapsedMs({ startedAt: 5000, finishedAt: null }, 1000)).toBe(0)
  })
})
