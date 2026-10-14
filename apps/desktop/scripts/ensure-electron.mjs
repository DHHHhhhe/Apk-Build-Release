// electron 44 的 package.json 里没有 postinstall，pnpm install 之后不会自动下载二进制；
// 这里在缺失时补跑 electron 自带的 install.js（已安装则它自己会快速返回）。
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

let electronDir
try {
  electronDir = dirname(require.resolve('electron/package.json'))
} catch {
  console.log('[ensure-electron] 未找到 electron 包，跳过')
  process.exit(0)
}

const pathFile = join(electronDir, 'path.txt')
const installScript = join(electronDir, 'install.js')

if (existsSync(pathFile)) {
  console.log('[ensure-electron] Electron 二进制已就绪')
  process.exit(0)
}

if (!existsSync(installScript)) {
  console.log('[ensure-electron] 未找到 install.js，跳过')
  process.exit(0)
}

console.log('[ensure-electron] 正在下载 Electron 二进制...')
const { spawnSync } = await import('node:child_process')
const result = spawnSync(process.execPath, [installScript], {
  cwd: electronDir,
  stdio: 'inherit'
})
process.exit(result.status ?? 1)
