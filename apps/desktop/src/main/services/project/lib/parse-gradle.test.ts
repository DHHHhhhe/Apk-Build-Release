import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractDeclaredNames, extractIncludes, parseProjectStatics } from './parse-gradle'

let workspace: string

function writeFile(relativePath: string, content: string): void {
  const fullPath = join(workspace, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf8')
}

function makeProject(options: {
  settings: string
  appBuild: string
  extraModules?: Record<string, string>
}): string {
  writeFile('settings.gradle', options.settings)
  writeFile('app/build.gradle', options.appBuild)
  for (const [relativePath, content] of Object.entries(options.extraModules ?? {})) {
    writeFile(relativePath, content)
  }
  return workspace
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'abr-parse-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('extractIncludes', () => {
  it('支持 Groovy 的多参数写法与注释', () => {
    const source = `
      // include ':ignored'
      include ':app'
      include ':lib_common', ':lib_security'
    `
    expect(extractIncludes(source)).toEqual([':app', ':lib_common', ':lib_security'])
  })

  it('支持 Kotlin DSL 的 include(":app")', () => {
    expect(extractIncludes('include(":app")\ninclude(":core")')).toEqual([':app', ':core'])
  })
})

describe('extractDeclaredNames', () => {
  it('读 Groovy 的 name { } 写法', () => {
    expect(extractDeclaredNames('demo_flavor {\n  applicationId "x"\n}\nfree {}\n')).toEqual([
      'demo_flavor',
      'free'
    ])
  })

  it('读 Kotlin DSL 的 create("name") 写法', () => {
    expect(extractDeclaredNames('create("paid") { }\nregister("demo") { }')).toEqual(['paid', 'demo'])
  })

  it('跳过 if/for 这类控制流块名', () => {
    expect(extractDeclaredNames('if (x) { }\nrelease { }')).toEqual(['release'])
  })
})

describe('parseProjectStatics', () => {
  it('无 flavor 的项目给出 buildType 变体', () => {
    const projectPath = makeProject({
      settings: "include ':app'",
      appBuild: `
        plugins { id 'com.android.application' }
        android {
          buildTypes {
            debug { }
            release { }
          }
        }
      `
    })

    const result = parseProjectStatics(projectPath)
    expect(result.ok).toBe(true)
    expect(result.appModules).toEqual([':app'])
    expect(result.variants.map((variant) => variant.name)).toEqual(['Debug', 'Release'])
    expect(result.variants.every((variant) => variant.flavor === null)).toBe(true)
  })

  it('多 flavor 项目组合出 flavor + buildType', () => {
    const projectPath = makeProject({
      settings: "include ':app'",
      appBuild: `
        plugins { id 'com.android.application' }
        android {
          flavorDimensions = ["channel"]
          productFlavors {
            demo_flavor { }
            free { }
          }
          buildTypes {
            debug { }
            release { }
          }
        }
      `
    })

    const result = parseProjectStatics(projectPath)
    expect(result.ok).toBe(true)
    expect(result.flavors).toEqual(['demo_flavor', 'free'])
    expect(result.flavorDimensions).toEqual(['channel'])
    expect(result.variants.map((variant) => variant.name)).toEqual([
      'demo_flavorDebug',
      'demo_flavorRelease',
      'freeDebug',
      'freeRelease'
    ])
    expect(result.limitations.some((note) => note.includes('applicationId'))).toBe(true)
  })

  it('读不到 buildTypes 时按 debug / release 假定并给出提示', () => {
    const projectPath = makeProject({
      settings: "include ':app'",
      appBuild: `plugins { id 'com.android.application' }\nandroid { }`
    })

    const result = parseProjectStatics(projectPath)
    expect(result.variants.map((variant) => variant.name)).toEqual(['Debug', 'Release'])
    expect(result.limitations.some((note) => note.includes('debug / release'))).toBe(true)
  })

  it('flavor 由变量生成时判为不可信，交给 Gradle 兜底', () => {
    const projectPath = makeProject({
      settings: "include ':app'",
      appBuild: `
        plugins { id 'com.android.application' }
        android {
          productFlavors {
            def names = ["a", "b"]
            names.each { n -> create(n) { } }
          }
        }
      `
    })

    const result = parseProjectStatics(projectPath)
    expect(result.ok).toBe(false)
    expect(result.limitations.some((note) => note.includes('读不出具体名字'))).toBe(true)
  })

  it('没有 application 模块时不硬猜', () => {
    const projectPath = makeProject({
      settings: "include ':lib'",
      appBuild: `plugins { id 'com.android.library' }`,
      extraModules: { 'lib/build.gradle': `plugins { id 'com.android.library' }` }
    })

    const result = parseProjectStatics(projectPath)
    expect(result.ok).toBe(false)
    expect(result.appModules).toEqual([])
    expect(result.limitations.some((note) => note.includes('com.android.application'))).toBe(true)
  })

  it('没有 settings 文件时明确报不可信', () => {
    const result = parseProjectStatics(join(workspace, 'empty-project'))
    expect(result.ok).toBe(false)
    expect(result.limitations[0]).toContain('settings.gradle')
  })
})
