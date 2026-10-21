import { describe, expect, it } from 'vitest'
import type { QueueRunDetail } from '@shared/types/queue'
import { variantProgressPercent } from './variant-progress'

const STARTED_AT = 1_000_000
const ESTIMATE = 60_000

function makeRun(patch: Partial<QueueRunDetail> = {}): QueueRunDetail {
  return {
    id: 'run-1',
    variant: 'demoDebug',
    state: 'running',
    startedAt: STARTED_AT,
    durationMs: null,
    estimatedMs: ESTIMATE,
    failureKind: null,
    failureHint: null,
    apkName: null,
    apkPath: null,
    logPath: null,
    ...patch
  }
}

describe('变体进度条百分比', () => {
  it('一半时间给到 50%', () => {
    expect(variantProgressPercent(makeRun(), STARTED_AT + 30_000, true)).toBe(50)
  })

  it('刚开跑时给一小段可见的宽度，不是 0', () => {
    expect(variantProgressPercent(makeRun(), STARTED_AT + 200, true)).toBe(2)
  })

  it('超过预估停在 100%，不越界', () => {
    expect(variantProgressPercent(makeRun(), STARTED_AT + 600_000, true)).toBe(100)
  })

  it('开关关掉时不给百分比（连「预计」文案也不该出现）', () => {
    expect(variantProgressPercent(makeRun(), STARTED_AT + 30_000, false)).toBeNull()
  })

  it('没有历史样本时不给百分比，而不是画一条 0% 的空条', () => {
    expect(variantProgressPercent(makeRun({ estimatedMs: null }), STARTED_AT + 30_000, true)).toBeNull()
  })

  it('估值非正时不画（脏数据兜底）', () => {
    expect(variantProgressPercent(makeRun({ estimatedMs: 0 }), STARTED_AT + 30_000, true)).toBeNull()
  })

  it('已经跑完或还没开跑都没有进度条', () => {
    expect(
      variantProgressPercent(makeRun({ state: 'success', durationMs: 30_000 }), STARTED_AT + 30_000, true)
    ).toBeNull()
    expect(variantProgressPercent(makeRun({ startedAt: null }), STARTED_AT + 30_000, true)).toBeNull()
  })
})
