import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProjectPreflightItem } from '@shared/types/project'
import { getOutputRoot } from '../../build/lib/settings'
import { findProjectRow } from './mapper'

/**
 * 入队前的廉价预检：**只查文件系统**，毫秒级，不跑 java 也不跑 Gradle。
 *
 * 跨项目批量入队以前不做任何检查（build-guard 里写明「没有为每个项目跑环境探测的代价预算」），
 * 于是缺 gradlew 或 SDK 的项目要等到真跑起来才失败 —— 用户白等几分钟才拿到原因。
 *
 * 这里只覆盖「一眼能看出缺东西」的那几种，不做完整环境探测：完整探测要起 java 进程，
 * 那是抽屉里逐项目手动触发的事。结果只用来**提示**，不拦入队。
 */
export function preflightProjects(projectIds: string[]): ProjectPreflightItem[] {
  const outputRoot = getOutputRoot()

  return projectIds.map((projectId) => {
    const project = findProjectRow(projectId)
    if (!project) {
      return { projectId, issues: ['项目不存在'] }
    }

    const issues: string[] = []
    if (!existsSync(project.path)) {
      issues.push('项目目录不存在')
    } else if (!hasGradlew(project.path)) {
      issues.push('找不到 gradlew / gradlew.bat，可能不是 Android 工程根目录')
    }

    if (outputRoot.trim() === '') {
      issues.push('还没设置统一输出目录')
    } else if (!existsSync(outputRoot) && !existsSync(dirname(outputRoot))) {
      issues.push('统一输出目录不存在，它的上一级也找不到')
    }

    return { projectId, issues }
  })
}

function hasGradlew(projectPath: string): boolean {
  return existsSync(join(projectPath, 'gradlew.bat')) || existsSync(join(projectPath, 'gradlew'))
}
