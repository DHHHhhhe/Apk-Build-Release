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

/** 从发布说明里取「### 本版内容」那一段（到下一个三级标题为止） */
function extractCurrentSection(notes) {
  const lines = notes.split(/\r?\n/)
  const start = lines.findIndex((line) => /^###\s*本版内容\s*$/.test(line))
  if (start === -1) {
    throw new Error('发布说明里没有「### 本版内容」这一节，先在 build/release-notes.md 里补上')
  }
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^###\s/.test(lines[i])) {
      break
    }
    body.push(lines[i])
  }
  // 说明里的四级标题（#### 分类）在 CHANGELOG 里要降一级：版本是二级标题，分类就得是三级
  const shifted = body.map((line) => line.replace(/^####\s/, '### ')).join('\n').trim()
  if (shifted === '') {
    throw new Error('「本版内容」是空的，没什么可同步的')
  }
  return shifted
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

const section = `## ${version} - ${today()}\n\n${extractCurrentSection(readFileSync(notesPath, 'utf8'))}\n`

// 插到第一个版本小节之前（也就是头部说明之后），保证「最新版本在最前」
const firstVersion = changelog.search(/^## /m)
if (firstVersion === -1) {
  throw new Error('CHANGELOG 里没有找到任何版本小节，格式可能被改坏了')
}

writeFileSync(changelogPath, `${changelog.slice(0, firstVersion)}${section}\n${changelog.slice(firstVersion)}`)
console.log(`已把 ${version} 同步进 CHANGELOG.md`)
