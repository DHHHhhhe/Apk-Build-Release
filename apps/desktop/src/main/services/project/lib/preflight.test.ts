import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let dbModule: typeof import('../../../db/client')
let preflight: typeof import('./preflight')

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-preflight-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')
  process.env.APK_BUILD_USER_DATA = workspace

  dbModule = await import('../../../db/client')
  dbModule.ensureSchema()
  preflight = await import('./preflight')

  const schema = await import('../../../db/schema')
  dbModule.db
    .insert(schema.projects)
    .values([
      { id: 'p-ok', name: '正常项目', path: join(workspace, 'ok') },
      { id: 'p-nogradlew', name: '缺 gradlew', path: join(workspace, 'no-gradlew') },
      { id: 'p-gone', name: '目录没了', path: join(workspace, 'not-exists') }
    ])
    .run()

  // 正常项目：目录 + gradlew 都在
  mkdirSync(join(workspace, 'ok'), { recursive: true })
  writeFileSync(join(workspace, 'ok', 'gradlew.bat'), 'x', 'utf8')
  // 缺 gradlew：目录在，但没有构建入口
  mkdirSync(join(workspace, 'no-gradlew'), { recursive: true })
  // 输出目录建出来并写进设置，避免它成为所有用例的公共噪声
  mkdirSync(join(workspace, 'out'), { recursive: true })
  const settings = await import('../../build/lib/settings')
  settings.setOutputRoot(join(workspace, 'out'))
})

afterAll(() => {
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('preflightProjects', () => {
  it('一切就绪时不给任何提示', () => {
    const [result] = preflight.preflightProjects(['p-ok'])
    expect(result?.issues).toEqual([])
  })

  it('目录不存在时说出来', async () => {
    const [result] = preflight.preflightProjects(['p-gone'])
    expect(result?.issues).toContain('项目目录不存在')
  })

  it('目录在但没有 gradlew 时给出可操作的原因', async () => {
    const [result] = preflight.preflightProjects(['p-nogradlew'])
    expect(result?.issues.join('')).toContain('gradlew')
  })

  it('项目已经不在库里时如实说明，不抛异常', () => {
    const [result] = preflight.preflightProjects(['p-missing'])
    expect(result?.issues).toEqual(['项目不存在'])
  })

  it('一次查多个项目，各给各的结论', async () => {
    const results = preflight.preflightProjects(['p-ok', 'p-gone'])
    expect(results).toHaveLength(2)
    expect(results[0]?.issues).toEqual([])
    expect(results[1]?.issues).toContain('项目目录不存在')
  })
})
