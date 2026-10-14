// 把本版发布说明并进仓库根的 CHANGELOG.md。发版前跑一次。
//
//   node scripts/sync-changelog.mjs           # 写入（幂等，重复跑无害）
//   node scripts/sync-changelog.mjs --check    # 只检查是否已同步，未同步则退出码 1（CI 用它拦漏跑）
//
// 为什么要有这一步：CHANGELOG.md 是界面「更新记录」的数据源，也是历史的唯一归档。
// 发布说明（build/release-notes.md）每次发版都被改写，历史只能靠这里留下。
// 漏跑的话，新版本不会出现在更新记录里 —— 而这件事要等到有人点开才发现。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // apps/desktop/scripts
const appDir = join(here, '..')
const repoRoot = join(appDir, '..', '..')
const notesPath = join(appDir, 'build', 'release-notes.md')
const changelogPath = join(repoRoot, 'CHANGELOG.md')

const version = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version
const checkOnly = process.argv.includes('--check')

/**
 * 取发布说明的正文。
 *
 * **这份文件整份就是 Release 正文的原文**：CI 拿它当 Release 正文，electron-builder 经
 * `releaseInfo.releaseNotesFile` 把它写进 `latest.yml` 当客户端的「更新内容」。
 * 所以里面不能有外层标题 —— 加了「# 发布说明」「### 本版内容」这类壳，用户那边就会先看到这两行
 * （曾经真的漏出去过四版，见 CHANGELOG 0.5.4）。
 */
function readNotes(file) {
  const body = readFileSync(file, 'utf8').trim()
  if (body === '') {
    throw new Error('发布说明是空的，没什么可同步的')
  }
  if (/^#\s*发布说明/m.test(body)) {
    throw new Error('发布说明里不要写「# 发布说明」这类外层标题 —— 这份文件整份就是正文')
  }
  return body
}

function today() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const changelog = readFileSync(changelogPath, 'utf8')
const alreadySynced = changelog.includes(`## ${version} -`)

if (alreadySynced) {
  console.log(`CHANGELOG 里已经有 ${version} 了，无需同步`)
  process.exit(0)
}

if (checkOnly) {
  console.error(`CHANGELOG 里还没有 ${version} —— 发版前先跑一次 scripts/sync-changelog.mjs`)
  process.exit(1)
}

const section = `## ${version} - ${today()}\n\n${readNotes(notesPath)}\n`

// 插到第一个版本小节之前（也就是头部说明之后），保证「最新版本在最前」
const firstVersion = changelog.search(/^## /m)
if (firstVersion === -1) {
  throw new Error('CHANGELOG 里没有找到任何版本小节，格式可能被改坏了')
}

writeFileSync(changelogPath, `${changelog.slice(0, firstVersion)}${section}\n${changelog.slice(firstVersion)}`)
console.log(`已把 ${version} 同步进 CHANGELOG.md`)
