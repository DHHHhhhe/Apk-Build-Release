import { describe, expect, it } from 'vitest'
import { resolveOutputFolderName } from './artifacts'

describe('输出目录的文件夹名', () => {
  it('有别名时用别名', () => {
    expect(resolveOutputFolderName({ alias: 'demo-a', name: 'template' })).toBe('demo-a')
  })

  it('没别名时用项目名', () => {
    expect(resolveOutputFolderName({ alias: null, name: 'template' })).toBe('template')
  })

  it('别名只有空白等于没填', () => {
    expect(resolveOutputFolderName({ alias: '   ', name: 'template' })).toBe('template')
  })

  it('别名前后空白会去掉', () => {
    expect(resolveOutputFolderName({ alias: '  demo-b  ', name: 'template' })).toBe('demo-b')
  })

  it('别名里的路径分隔符会被净化，不会跑出输出目录', () => {
    const folder = resolveOutputFolderName({ alias: '../a/b:c', name: 'template' })
    expect(folder).not.toContain('/')
    expect(folder).not.toContain('\\')
    expect(folder).not.toContain('..')
  })
})