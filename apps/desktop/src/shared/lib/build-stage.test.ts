import { describe, expect, it } from 'vitest'
import {
  collapseToStageChanges,
  progressCountText,
  progressHeadline,
  stageDurations,
  stageKeyOfLine,
  stagePointText,
  taskStageLabel
} from './build-stage'

describe('taskStageLabel', () => {
  it('按任务名前缀给出更具体的一步', () => {
    expect(taskStageLabel('compileFreeDebugJavaWithJavac')).toBe('编译源码')
    expect(taskStageLabel('mergeFreeDebugResources')).toBe('处理资源')
    expect(taskStageLabel('packageFreeDebug')).toBe('打包')
    expect(taskStageLabel('assembleFreeDebug')).toBe('收尾')
  })

  it('认不出或没有任务时返回 null，不猜', () => {
    expect(taskStageLabel(null)).toBeNull()
    expect(taskStageLabel('')).toBeNull()
    expect(taskStageLabel('someUnknownTask')).toBeNull()
  })
})

describe('progressHeadline', () => {
  it('有具体任务名时用它，否则回退到阶段名', () => {
    expect(progressHeadline({ phase: 'executing', task: 'compileDebugJavaWithJavac' })).toBe('编译源码')
    expect(progressHeadline({ phase: 'downloading', task: null })).toBe('下载依赖')
    expect(progressHeadline({ phase: 'archiving', task: null })).toBe('归档产物')
  })
})

describe('progressCountText', () => {
  it('还没执行任务时不显示，避免「已执行 0 个」', () => {
    expect(progressCountText({ tasksDone: 0 })).toBeNull()
    expect(progressCountText({ tasksDone: 7 })).toBe('已执行 7 个任务')
  })
})

describe('stageKeyOfLine', () => {
  it('把 Gradle 的关键行归类，普通任务输出归为 null', () => {
    expect(stageKeyOfLine('> Task :app:compileDebugJavaWithJavac')).toBe('task:编译源码')
    expect(stageKeyOfLine('> Configure project :app')).toBe('configure')
    expect(stageKeyOfLine('Downloading https://services.gradle.org/x.zip')).toBe('download')
    expect(stageKeyOfLine('BUILD SUCCESSFUL in 12s')).toBe('done')
    expect(stageKeyOfLine('w: some warning from kotlinc')).toBeNull()
    expect(stageKeyOfLine('')).toBeNull()
  })
})

describe('stagePointText', () => {
  it('带任务名时给「步骤 · 任务」，阶段切换点只给步骤', () => {
    expect(stagePointText({ phase: 'executing', task: 'compileDebugJavaWithJavac', tasksDone: 3 })).toBe(
      '编译源码 · compileDebugJavaWithJavac'
    )
    expect(stagePointText({ phase: 'downloading', task: null, tasksDone: 0 })).toBe('下载依赖')
  })
})

describe('collapseToStageChanges', () => {
  it('同一类别连续的行只留第一条，把几千行压成切换点', () => {
    const lines = [
      '> Configure project :app',
      '> Task :app:preBuild',
      '> Task :app:preDebugBuild',
      '> Task :app:compileDebugJavaWithJavac',
      '> Task :app:compileDebugKotlin',
      '> Task :app:packageDebug',
      '> Task :app:assembleDebug',
      'BUILD SUCCESSFUL in 12s'
    ]
    expect(collapseToStageChanges(lines)).toEqual([
      '> Configure project :app',
      '> Task :app:preBuild',
      '> Task :app:compileDebugJavaWithJavac',
      '> Task :app:packageDebug',
      '> Task :app:assembleDebug',
      'BUILD SUCCESSFUL in 12s'
    ])
  })

  it('全部是普通输出时返回空数组（过滤后界面显示「没有匹配的行」）', () => {
    expect(collapseToStageChanges(['w: warning', 'some output'])).toEqual([])
  })
})

describe('stageDurations', () => {
  const points = [{ at: 1000 }, { at: 4000 }, { at: 9000 }]

  it('每个节点给出到下一个节点的间隔', () => {
    expect(stageDurations(points, { finishedAt: 20000 }, 0)).toEqual([3000, 5000, 11000])
  })

  it('跑着的最后一段用 now 兜底，数字跟着心跳走', () => {
    expect(stageDurations(points, { finishedAt: null }, 12000)).toEqual([3000, 5000, 3000])
  })

  it('时间倒退给 null，不编负数', () => {
    // 落库顺序异常：第二个节点的时间早于第一个
    expect(stageDurations([{ at: 9000 }, { at: 4000 }], { finishedAt: 5000 }, 0)).toEqual([
      null,
      1000
    ])
  })

  it('没有节点时不产出任何耗时', () => {
    expect(stageDurations([], { finishedAt: 5000 }, 0)).toEqual([])
  })
})
