import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SpawnOptions } from 'node:child_process'

export const isWindows = process.platform === 'win32'

/** 项目里的 Gradle Wrapper；Windows 上优先 gradlew.bat */
export function locateGradlew(projectPath: string): string | null {
  const candidates = isWindows ? ['gradlew.bat', 'gradlew'] : ['gradlew', 'gradlew.bat']
  for (const candidate of candidates) {
    const fullPath = join(projectPath, candidate)
    if (existsSync(fullPath)) {
      return fullPath
    }
  }
  return null
}

export interface GradleSpawnPlan {
  command: string
  args: string[]
  options: SpawnOptions
}

/**
 * 组装启动 .bat / .exe 的命令（Gradle Wrapper、apksigner 都用它）。
 * Windows 上的引号写法是实测出来的：
 *   cmd.exe /d /s /c ""<程序>" <参数...>"  + windowsVerbatimArguments
 * 少一层外层引号、或让 Node 自动转义（会变成 \"）都会让 cmd 认不出命令；
 * 逐参数传递则扛不住带空格的路径。细节见 .trellis/spec/big-question/windows-spawn-bat-quoting.md
 */
export function planSpawn(
  programPath: string,
  programArgs: string[],
  cwd: string,
  extraOptions: SpawnOptions = {}
): GradleSpawnPlan {
  if (!isWindows) {
    return {
      command: programPath,
      args: programArgs,
      options: { cwd, env: { ...process.env }, ...extraOptions }
    }
  }

  const quotedArgs = programArgs
    .map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
    .join(' ')

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `""${programPath}" ${quotedArgs}"`],
    options: {
      cwd,
      env: { ...process.env },
      windowsHide: true,
      windowsVerbatimArguments: true,
      ...extraOptions
    }
  }
}
