import { describe, expect, it } from 'vitest'
import { buildBlockedReason, enqueueTargets, queuedExclusionHint } from './build-guard'
import type { BuildGuardInput } from './build-guard'

function input(patch: Partial<BuildGuardInput> = {}): BuildGuardInput {
  return {
    pendingWrites: 0,
    buildableVariantCount: 0,
    pendingProjectCount: 0,
    queuedProjectCount: 0,
    unknownSelectedCount: 0,
    ...patch
  }
}

describe('buildBlockedReason', () => {
  it('写入没落盘时先拦住 —— 这是「所见即所建」的关键', () => {
    expect(
      buildBlockedReason(input({ pendingWrites: 1, buildableVariantCount: 3, pendingProjectCount: 2 }))
    ).toBe('正在保存勾选…')
  })

  it('没勾任何变体时给出原因，不是静默无效', () => {
    expect(buildBlockedReason(input())).toBe('先勾选至少一个发布变体')
  })

  it('勾的变体已被改名或删掉时，提示去刷新变体', () => {
    expect(buildBlockedReason(input({ unknownSelectedCount: 1 }))).toBe(
      '勾选的变体已不在项目里，先刷新变体'
    )
  })

  it('有可构建变体但项目都在队列里时说明原因', () => {
    expect(
      buildBlockedReason(
        input({ buildableVariantCount: 2, pendingProjectCount: 0, queuedProjectCount: 2 })
      )
    ).toBe('勾选的项目都在队列里了')
  })

  it('变体数与项目数不能混着比：变体 2 个、待入队 1 个项目时不该被拦', () => {
    expect(
      buildBlockedReason(
        input({ buildableVariantCount: 2, pendingProjectCount: 1, queuedProjectCount: 1 })
      )
    ).toBeNull()
  })

  it('有可构建变体且没在保存时返回 null（按钮可点）', () => {
    expect(
      buildBlockedReason(
        input({ buildableVariantCount: 3, pendingProjectCount: 2, queuedProjectCount: 1 })
      )
    ).toBeNull()
  })

  it('保存中优先于其他原因：避免用户以为是自己没勾', () => {
    expect(buildBlockedReason(input({ pendingWrites: 2, unknownSelectedCount: 1 }))).toBe(
      '正在保存勾选…'
    )
  })
})

describe('queuedExclusionHint', () => {
  it('有项目会被跳过时给出数量', () => {
    expect(
      queuedExclusionHint(
        input({ buildableVariantCount: 4, pendingProjectCount: 2, queuedProjectCount: 1 })
      )
    ).toBe('另有 1 个项目已在队列中，本次会跳过')
  })

  it('没有队列中项目时不提示', () => {
    expect(queuedExclusionHint(input({ buildableVariantCount: 4, pendingProjectCount: 2 }))).toBeNull()
  })

  it('一个项目都入不了队时不补这句（原因已经说清了）', () => {
    expect(
      queuedExclusionHint(input({ pendingProjectCount: 0, queuedProjectCount: 2 }))
    ).toBeNull()
  })
})

describe('enqueueTargets', () => {
  const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
  const resolutions = new Map([
    ['p1', { buildable: ['demoRelease'] }],
    ['p2', { buildable: ['paidRelease'] }],
    ['p3', { buildable: [] }]
  ])

  it('带上这次要打的变体，并排除没有可构建变体的项目', () => {
    expect(enqueueTargets(projects, resolutions, new Set())).toEqual([
      { projectId: 'p1', variants: ['demoRelease'] },
      { projectId: 'p2', variants: ['paidRelease'] }
    ])
  })

  it('排除已在队列中的项目 —— 点了不该没反应', () => {
    expect(enqueueTargets(projects, resolutions, new Set(['p2']))).toEqual([
      { projectId: 'p1', variants: ['demoRelease'] }
    ])
  })

  it('全都不可入队时返回空数组', () => {
    expect(enqueueTargets(projects, resolutions, new Set(['p1', 'p2']))).toEqual([])
    expect(enqueueTargets([], resolutions, new Set())).toEqual([])
  })

  it('结果里没有该项目的解析时按不可入队处理，不抛异常', () => {
    expect(enqueueTargets([{ id: 'missing' }], resolutions, new Set())).toEqual([])
  })
})
