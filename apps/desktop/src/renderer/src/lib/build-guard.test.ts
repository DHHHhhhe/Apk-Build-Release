import { describe, expect, it } from 'vitest'
import {
  buildBlockedReason,
  currentProjectBlockedReason,
  enqueueTargets,
  queuedExclusionHint,
  queuedVariantMap
} from './build-guard'
import type { BuildGuardInput, CurrentProjectGuardInput } from './build-guard'

function input(patch: Partial<BuildGuardInput> = {}): BuildGuardInput {
  return {
    pendingWrites: 0,
    buildableVariantCount: 0,
    queuedVariantCount: 0,
    pendingProjectCount: 0,
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

  it('勾的变体全都已经在队列里时，说清是「等它跑完」而不是「没勾」', () => {
    expect(
      buildBlockedReason(input({ buildableVariantCount: 0, queuedVariantCount: 2 }))
    ).toBe('勾选的变体都已经在队列里了，等它们跑完再试')
  })

  it('有可构建变体且没在保存时返回 null（按钮可点）', () => {
    expect(
      buildBlockedReason(
        input({ buildableVariantCount: 1, queuedVariantCount: 2, pendingProjectCount: 1 })
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
  it('有变体被跳过时给出数量，并说明是追加', () => {
    expect(
      queuedExclusionHint(
        input({ buildableVariantCount: 3, queuedVariantCount: 2, pendingProjectCount: 2 })
      )
    ).toBe('其中 2 个变体已在队列里，本次只追加其余')
  })

  it('没有队列中变体时不提示', () => {
    expect(queuedExclusionHint(input({ buildableVariantCount: 4, pendingProjectCount: 2 }))).toBeNull()
  })

  it('一个都入不了队时不补这句（原因已经说清了）', () => {
    expect(queuedExclusionHint(input({ pendingProjectCount: 0, queuedVariantCount: 2 }))).toBeNull()
  })
})

describe('queuedVariantMap', () => {
  it('只统计没结束的项；已结束的项释放它的变体', () => {
    const map = queuedVariantMap([
      { projectId: 'p1', state: 'running', variants: ['demoRelease', 'paidRelease'] },
      { projectId: 'p1', state: 'success', variants: ['freeRelease'] },
      { projectId: 'p2', state: 'pending', variants: ['paidDebug'] }
    ])
    expect(Array.from(map.get('p1') ?? []).sort()).toEqual(['demoRelease', 'paidRelease'])
    expect(Array.from(map.get('p2') ?? [])).toEqual(['paidDebug'])
  })
})

describe('enqueueTargets', () => {
  const projects = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]
  const resolutions = new Map([
    ['p1', { buildable: ['demoRelease'] }],
    ['p2', { buildable: ['paidRelease', 'paidDebug'] }],
    ['p3', { buildable: [] }]
  ])

  it('带上这次要打的变体，并排除没有可构建变体的项目', () => {
    expect(enqueueTargets(projects, resolutions, new Map())).toEqual([
      { projectId: 'p1', variants: ['demoRelease'] },
      { projectId: 'p2', variants: ['paidRelease', 'paidDebug'] }
    ])
  })

  it('只剔掉已在队列里的变体，其余照常追加', () => {
    const occupied = new Map([['p2', new Set(['paidRelease'])]])
    expect(enqueueTargets(projects, resolutions, occupied)).toEqual([
      { projectId: 'p1', variants: ['demoRelease'] },
      { projectId: 'p2', variants: ['paidDebug'] }
    ])
  })

  it('一个项目的变体全在队列里时，整个项目不出现', () => {
    const occupied = new Map([
      ['p1', new Set(['demoRelease'])],
      ['p2', new Set(['paidRelease', 'paidDebug'])]
    ])
    expect(enqueueTargets(projects, resolutions, occupied)).toEqual([])
  })

  it('结果里没有该项目的解析时按不可入队处理，不抛异常', () => {
    expect(enqueueTargets([{ id: 'missing' }], resolutions, new Map())).toEqual([])
  })
})

describe('currentProjectBlockedReason', () => {
  function current(patch: Partial<CurrentProjectGuardInput> = {}): CurrentProjectGuardInput {
    return {
      variantCount: 0,
      busy: false,
      queuedVariantCount: 0,
      envIssue: null,
      ...patch
    }
  }

  it('环境有问题时优先说明环境，而不是让用户白等一次构建', () => {
    expect(currentProjectBlockedReason(current({ variantCount: 2, envIssue: 'SDK 不可用' }))).toBe(
      '构建环境有问题：SDK 不可用'
    )
  })

  it('主进程忙时用与勾选表同一句措辞', () => {
    expect(currentProjectBlockedReason(current({ variantCount: 2, busy: true }))).toBe(
      '正在处理上一个操作…'
    )
  })

  it('没勾变体时给出原因', () => {
    expect(currentProjectBlockedReason(current({ variantCount: 0 }))).toBe(
      '先在发布变体里勾选至少一个'
    )
  })

  it('勾的变体全在队列里时，说清是「等它跑完」', () => {
    expect(
      currentProjectBlockedReason(current({ variantCount: 0, queuedVariantCount: 1 }))
    ).toBe('勾选的变体都已经在队列里了，等它们跑完再试')
  })

  it('项目在跑一个变体、另一个变体还能入队时不拦（追加）', () => {
    expect(
      currentProjectBlockedReason(current({ variantCount: 1, queuedVariantCount: 1 }))
    ).toBeNull()
  })

  it('可构建时返回 null', () => {
    expect(currentProjectBlockedReason(current({ variantCount: 3 }))).toBeNull()
  })

  it('忙优先于环境问题：先解释为什么点不动', () => {
    expect(
      currentProjectBlockedReason(current({ variantCount: 3, busy: true, envIssue: 'SDK 不可用' }))
    ).toBe('正在处理上一个操作…')
  })
})
