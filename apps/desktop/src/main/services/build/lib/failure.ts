import type { BuildFailureKind } from '@shared/types/build'

export interface FailureClassification {
  kind: BuildFailureKind
  hint: string | null
}

/**
 * 把 Gradle 失败归类，给用户一句能动手的原因。
 * 顺序有讲究：OOM 与缺 SDK 的报错里也常出现 "FAILURE: Build failed"，所以先匹配更具体的。
 */
export function classifyFailure(input: {
  exitCode: number | null
  timedOut: boolean
  output: string
}): FailureClassification {
  if (input.timedOut) {
    return { kind: 'timeout', hint: '构建超时被中止；项目过大或依赖下载卡住时都可能出现' }
  }

  const output = input.output

  if (/OutOfMemoryError|Java heap space|GC overhead limit exceeded|Metaspace/i.test(output)) {
    return {
      kind: 'oom',
      hint: '构建进程内存不足。可以在项目 gradle.properties 里调大 org.gradle.jvmargs 的 -Xmx，或把并发降到 1'
    }
  }

  if (
    /SDK location not found|Failed to install the following Android SDK packages|Failed to find target with hash string|platforms;android-|build-tools;\d|licenses? not accepted/i.test(
      output
    )
  ) {
    return {
      kind: 'missing-sdk',
      hint: '缺少所需的 Android SDK 组件或未接受许可。用 sdkmanager 装上对应 platforms / build-tools 后重试'
    }
  }

  if (/Unsupported class file major version|requires Java \d+|Could not determine java version/i.test(output)) {
    return {
      kind: 'java-version',
      hint: 'JDK 版本与项目要求不符。AGP 8.x 起需要 JDK 17，老项目可能只支持 JDK 11'
    }
  }

  if (/gradlew.*(not found|is not recognized)|系统找不到指定的路径/i.test(output)) {
    return { kind: 'missing-gradlew', hint: '找不到项目的 gradlew，确认项目根目录下有 Gradle Wrapper' }
  }

  const gradleFailure = extractGradleFailure(output)
  if (gradleFailure) {
    return { kind: 'gradle', hint: gradleFailure }
  }

  if (input.exitCode !== 0) {
    return { kind: 'unknown', hint: null }
  }

  return { kind: 'unknown', hint: null }
}

/** 从输出里截取 Gradle 的失败说明，界面直接展示这一段就够定位 */
export function extractGradleFailure(output: string): string | null {
  const whatWentWrong = /\* What went wrong:[\s\S]{0,500}/.exec(output)
  if (whatWentWrong) {
    return whatWentWrong[0].replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  const failure = /FAILURE: Build failed with an exception[\s\S]{0,400}/.exec(output)
  if (failure) {
    return failure[0].replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  const executionFailed = /Execution failed for task '[^']+'[\s\S]{0,300}/.exec(output)
  if (executionFailed) {
    return executionFailed[0].replace(/\s+/g, ' ').trim().slice(0, 400)
  }

  return null
}
