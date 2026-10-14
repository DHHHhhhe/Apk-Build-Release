// 本机的 pnpm 由 DSH Desktop（Electron）以 ELECTRON_RUN_AS_NODE=1 的身份运行，
// 于是脚本进程里：process.execPath 指向 Electron、环境里有 ELECTRON_RUN_AS_NODE=1。
// 后果是 electron-vite 再去 spawn electron 时，Electron 会退化成纯 Node：
// require('electron') 返回路径字符串、app 为 undefined，main 一启动就抛错。
//
// 这个包装器做两件事：
//   1. 从环境里删掉 ELECTRON_RUN_AS_NODE；
//   2. 用真正的 node 可执行文件去跑工具入口（绕开 .bin shim 与 Electron 冒充的 node）。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const isWindows = process.platform === 'win32'
const nodeBinaryName = isWindows ? 'node.exe' : 'node'

// 找真正的 node：优先环境变量，其次 PATH 里排除掉 Electron 冒充的目录
function resolveRealNode() {
  for (const candidate of [process.env.npm_node_execpath, process.env.NODE_EXEC_PATH]) {
    if (candidate && new RegExp(`${nodeBinaryName}$`, 'i').test(candidate) && existsSync(candidate)) {
      return candidate
    }
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || /DSH Desktop/i.test(dir)) {
      continue
    }
    const candidate = join(dir, nodeBinaryName)
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return new RegExp(`${nodeBinaryName}$`, 'i').test(process.execPath) ? process.execPath : null
}

// 解析包的 bin 入口脚本绝对路径，避免经过 node_modules/.bin 的 .cmd shim
function resolveBinEntry(packageName) {
  const packageJsonPath = findPackageJson(packageName)
  if (!packageJsonPath) {
    return null
  }
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  if (!pkg.bin) {
    return null
  }
  const binRelative =
    typeof pkg.bin === 'string'
      ? pkg.bin
      : (pkg.bin[packageName.replace(/^@[^/]+\//, '')] ?? Object.values(pkg.bin)[0])
  if (!binRelative) {
    return null
  }
  const binPath = join(dirname(packageJsonPath), binRelative)
  return existsSync(binPath) ? binPath : null
}

function findPackageJson(packageName) {
  try {
    return require.resolve(`${packageName}/package.json`)
  } catch {
    // exports 可能挡住 package.json 子路径，退回从主入口往上找
  }
  try {
    let dir = dirname(require.resolve(packageName))
    while (dir !== dirname(dir)) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        return candidate
      }
      dir = dirname(dir)
    }
  } catch {
    return null
  }
  return null
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('用法: node scripts/run.mjs <命令> [参数...]')
  process.exit(1)
}

const realNode = resolveRealNode()
const binEntry = realNode ? resolveBinEntry(command) : null

const executable = binEntry ? realNode : command
const finalArgs = binEntry ? [binEntry, ...args] : args

if (env.DSH_DEBUG_ELECTRON === '1') {
  console.log(
    `[run] RUN_AS_NODE=${String(env.ELECTRON_RUN_AS_NODE)} node=${String(realNode)} 执行=${executable} ${finalArgs.join(' ')}`
  )
}

const child = spawn(executable, finalArgs, { stdio: 'inherit', env })

child.on('close', (code) => {
  process.exit(code ?? 0)
})
