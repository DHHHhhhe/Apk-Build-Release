import { describe, expect, it } from 'vitest'
import { GradleProgressParser, phaseForTask, shortTaskName } from './gradle-progress'

/** 拼一个从 initial 状态开始喂完整输出的解析器 */
function feedAll(text: string): GradleProgressParser {
  const parser = new GradleProgressParser()
  parser.feed(text)
  return parser
}

describe('shortTaskName', () => {
  it('去掉模块前缀，保留最后一段任务名', () => {
    expect(shortTaskName(':app:compileFreeDebugJavaWithJavac')).toBe('compileFreeDebugJavaWithJavac')
    expect(shortTaskName(':lib:sub:dexRelease')).toBe('dexRelease')
    expect(shortTaskName('assemble')).toBe('assemble')
  })
})

describe('phaseForTask', () => {
  it('组装 APK 的任务算 packaging，其余算 executing', () => {
    expect(phaseForTask('packageFreeDebug')).toBe('packaging')
    expect(phaseForTask('assembleFreeDebug')).toBe('packaging')
    expect(phaseForTask('mergeFreeDebugNativeLibs')).toBe('executing')
    expect(phaseForTask('compileFreeDebugJavaWithJavac')).toBe('executing')
  })
})

describe('GradleProgressParser', () => {
  it('按任务行推进阶段并累计执行数', () => {
    const parser = feedAll(
      [
        '> Configure project :app',
        '> Task :app:preFreeDebugBuild',
        '> Task :app:compileFreeDebugJavaWithJavac',
        ''
      ].join('\n')
    )
    const progress = parser.snapshot()
    expect(progress.phase).toBe('executing')
    expect(progress.task).toBe('compileFreeDebugJavaWithJavac')
    expect(progress.tasksDone).toBe(2)
  })

  it('UP-TO-DATE 计入跳过，不算执行，也不改当前任务', () => {
    const parser = feedAll(
      ['> Task :app:a', '> Task :app:b UP-TO-DATE', '> Task :app:c FROM-CACHE', ''].join('\n')
    )
    const progress = parser.snapshot()
    expect(progress.tasksDone).toBe(1)
    expect(progress.tasksSkipped).toBe(2)
    expect(progress.task).toBe('a')
  })

  it('下载依赖单独成阶段，下一个任务行把它顶掉', () => {
    const parser = new GradleProgressParser()
    parser.feed('Downloading https://services.gradle.org/distributions/gradle-8.10.2-bin.zip\n')
    expect(parser.snapshot().phase).toBe('downloading')

    parser.feed('> Task :app:preBuild\n')
    expect(parser.snapshot().phase).toBe('executing')
    expect(parser.snapshot().task).toBe('preBuild')
  })

  it('被打断的行会跨 chunk 拼起来，不丢任务名', () => {
    const parser = new GradleProgressParser()
    parser.feed('> Task :app:comp')
    expect(parser.snapshot().tasksDone).toBe(0)

    parser.feed('ileFreeDebugJavaWithJavac\n')
    expect(parser.snapshot().task).toBe('compileFreeDebugJavaWithJavac')
    expect(parser.snapshot().tasksDone).toBe(1)
  })

  it('包装任务是 packaging，BUILD SUCCESSFUL 之后仍是 packaging（等执行器接手）', () => {
    const parser = feedAll(['> Task :app:packageFreeDebug', 'BUILD SUCCESSFUL in 12s', ''].join('\n'))
    expect(parser.snapshot().phase).toBe('packaging')
    expect(parser.snapshot().task).toBeNull()
  })

  it('没有实质变化时返回 null，变化时返回快照', () => {
    const parser = new GradleProgressParser()
    expect(parser.feed('')).toBeNull()
    expect(parser.feed('something unrelated\n')).toBeNull()
    expect(parser.feed('> Task :app:preBuild\n')).not.toBeNull()
    // 重复喂同样的行：计数会变，所以这里用「无意义输出」验证 null
    expect(parser.feed('\n\n')).toBeNull()
  })

  it('配置缓存复用直接进入 executing', () => {
    const parser = feedAll('Reusing configuration cache.\n')
    expect(parser.snapshot().phase).toBe('executing')
  })

  it('CRLF 与单独 \\r 都能切行', () => {
    const parser = feedAll('> Task :app:a\r\n> Task :app:b\r' + '> Task :app:c\n')
    expect(parser.snapshot().tasksDone).toBe(3)
    expect(parser.snapshot().task).toBe('c')
  })

  it('UNKNOWN 输出不会把阶段改坏', () => {
    const parser = feedAll('Deprecated Gradle features were used in this build\n')
    expect(parser.snapshot().phase).toBe('starting')
    expect(parser.snapshot().tasksDone).toBe(0)
  })

  it('阶段点按类别累积，同一类别的连续任务只记一条', () => {
    const parser = feedAll(
      [
        '> Task :app:preBuild',
        '> Task :app:compileDebugJavaWithJavac',
        '> Task :app:compileDebugKotlin',
        '> Task :app:packageDebug',
        ''
      ].join('\n')
    )
    const stages = parser.snapshot().stages
    // 准备 / 编译源码 / 打包：三个类别；两个 compile 任务只算一个节点
    expect(stages.map((point) => point.task)).toEqual([
      'preBuild',
      'compileDebugJavaWithJavac',
      'packageDebug'
    ])
    expect(stages.map((point) => point.tasksDone)).toEqual([1, 2, 4])
  })

  it('下载与收尾也进阶段点，且节点数不受任务数影响', () => {
    const parser = feedAll(
      ['Downloading https://x/y.zip', '> Task :app:packageDebug', 'BUILD SUCCESSFUL in 3s', ''].join('\n')
    )
    const stages = parser.snapshot().stages
    expect(stages.map((point) => point.phase)).toEqual(['downloading', 'packaging', 'packaging'])
    expect(parser.snapshot().tasksDone).toBe(1)
  })
})
