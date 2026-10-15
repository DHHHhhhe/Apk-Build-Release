import { describe, expect, it } from 'vitest'
import { formatBytes } from './bytes'

/**
 * 产物大小显示。界面上的数字，边界在 1024 那一跳：
 * 1023 必须还是 B，1024 必须进位成 KB —— 差一字节就换单位是最容易写错的地方。
 */
describe('formatBytes', () => {
  it('进位点卡在 1024：1023 还是 B，1024 进位成 KB', () => {
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('KB 到 MB、MB 到 GB 同样卡在 1024', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('B 档不带小数，其它档保留一位', () => {
    expect(formatBytes(1)).toBe('1 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('到 GB 就封顶，不再往上翻（没有 TB 这一档）', () => {
    expect(formatBytes(1024 ** 4)).toBe('1024.0 GB')
  })

  it('零、负数、NaN、Infinity 都给占位符，不显示 NaN 或 -0', () => {
    expect(formatBytes(0)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
  })
})