import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let workspace: string
let projectPath: string

let addProject: (input: unknown) => Promise<{ success: boolean; error?: string; project: unknown }>
let listProjects: () => { success: boolean; projects: Array<{ id: string; selectedVariants: string[]; variants: Array<{ name: string }> }> }
let setProjectVariants: (input: unknown) => { success: boolean; error?: string; project: unknown }
let refreshProjectVariants: (input: unknown) => Promise<{ success: boolean; project: unknown }>
let removeProject: (input: unknown) => { success: boolean; error?: string }

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(workspace, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-db-'))
  process.env.APK_BUILD_DB_PATH = join(workspace, 'test.db')

  projectPath = join(workspace, 'sample-project')
  writeFile(
    'sample-project/settings.gradle',
    "include ':app'\ninclude ':lib_common'\n"
  )
  writeFile(
    'sample-project/app/build.gradle',
    `plugins { id 'com.android.application' }
     android {
       productFlavors {
         demo_flavor { }
         free { }
       }
       buildTypes {
         debug { }
         release { }
       }
     }`
  )
  writeFile('sample-project/lib_common/build.gradle', `plugins { id 'com.android.library' }`)
  writeFile('sample-project/gradlew.bat', '@echo off\n')

  const dbModule = await import('../../../db/client')
  dbModule.ensureSchema()

  addProject = (await import('./add')).addProject
  listProjects = (await import('./list')).listProjects
  setProjectVariants = (await import('./set-variants')).setProjectVariants
  refreshProjectVariants = (await import('./refresh-variants')).refreshProjectVariants
  removeProject = (await import('./remove')).removeProject
})

afterAll(async () => {
  // 先关掉 SQLite 连接，否则 Windows 上临时目录会因文件占用删不掉
  const dbModule = await import('../../../db/client')
  dbModule.sqlite.close()
  rmSync(workspace, { recursive: true, force: true })
})

describe('项目登记与变体持久化', () => {
  it('添加项目后能解析出全部变体并落库', async () => {
    const result = await addProject({ path: projectPath })
    expect(result.success).toBe(true)

    const projects = listProjects().projects
    expect(projects).toHaveLength(1)
    expect(projects[0]?.variants.map((variant) => variant.name).sort()).toEqual([
      'demo_flavorDebug',
      'demo_flavorRelease',
      'freeDebug',
      'freeRelease'
    ])
    expect(projects[0]?.selectedVariants).toEqual([])
  })

  it('重复添加同一路径会被拒绝并说清原因', async () => {
    const result = await addProject({ path: projectPath })
    expect(result.success).toBe(false)
    expect(result.error).toContain('已经添加过')
  })

  it('路径大小写不同或末尾多一个分隔符，同样算同一个项目', async () => {
    const trailing = await addProject({ path: `${projectPath}\\` })
    expect(trailing.success).toBe(false)
    expect(trailing.error).toContain('已经添加过')

    if (process.platform === 'win32') {
      const upper = await addProject({ path: projectPath.toUpperCase() })
      expect(upper.success).toBe(false)
      expect(upper.error).toContain('已经添加过')
    }
  })

  it('路径不存在或不是目录时给出可读错误', async () => {
    const missing = await addProject({ path: join(workspace, 'not-exist') })
    expect(missing.success).toBe(false)
    expect(missing.error).toContain('不存在')

    const filePath = join(workspace, 'sample-project', 'settings.gradle')
    const notDirectory = await addProject({ path: filePath })
    expect(notDirectory.success).toBe(false)
    expect(notDirectory.error).toContain('目录')
  })

  it('保存变体选择时丢掉无效名字并如实回报', async () => {
    const projectId = listProjects().projects[0]?.id ?? ''
    const result = setProjectVariants({
      projectId,
      variants: ['demo_flavorRelease', 'not_a_variant']
    })

    expect(result.success).toBe(true)
    expect(result.error).toContain('not_a_variant')
    expect(listProjects().projects[0]?.selectedVariants).toEqual(['demo_flavorRelease'])
  })

  it('刷新变体后已选项仍然有效', async () => {
    const projectId = listProjects().projects[0]?.id ?? ''
    const result = await refreshProjectVariants({ projectId, force: false })
    expect(result.success).toBe(true)
    expect(listProjects().projects[0]?.selectedVariants).toEqual(['demo_flavorRelease'])
  })

  it('移除项目后列表为空', () => {
    const projectId = listProjects().projects[0]?.id ?? ''
    expect(removeProject({ projectId }).success).toBe(true)
    expect(listProjects().projects).toHaveLength(0)
  })

  it('移除不存在的项目给出可读错误', () => {
    const result = removeProject({ projectId: 'missing-id' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('不在列表')
  })
})
