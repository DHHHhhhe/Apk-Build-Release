import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 便携版判断。
 *
 * 用户可见行为：便携版一律没有自动更新（它每次启动自解压到临时目录，装更新只会多出一份副本）。
 * 判据是 electron-builder 给便携版设的环境变量。
 *
 * 两个 mock 都是本测试自带的，不动共享桩：
 *   electron-updater —— updater 在导入期就会配置它
 *   electron         —— 共享桩里没有 getVersion，而 updater 在模块级会调它
 */
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (): void => {},
    checkForUpdates: async (): Promise<null> => null,
    quitAndInstall: (): void => {},
    downloadUpdate: async (): Promise<unknown[]> => [],
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    logger: null
  }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: (): string => '0.0.0-test',
    isPackaged: false,
    on: (): void => {},
    getPath: (): string => ''
  },
  BrowserWindow: {
    getAllWindows: (): unknown[] => []
  }
}))

const KEY = 'PORTABLE_EXECUTABLE_DIR'
let original: string | undefined

beforeEach(() => {
  original = process.env[KEY]
})

afterEach(() => {
  if (original === undefined) {
    delete process.env[KEY]
  } else {
    process.env[KEY] = original
  }
})

describe('isPortableBuild', () => {
  it('没有这个环境变量时不是便携版', async () => {
    const { isPortableBuild } = await import('../updater')
    delete process.env[KEY]
    expect(isPortableBuild()).toBe(false)
  })

  it('有 PORTABLE_EXECUTABLE_DIR 时是便携版', async () => {
    const { isPortableBuild } = await import('../updater')
    process.env[KEY] = 'C:\\somewhere'
    expect(isPortableBuild()).toBe(true)
  })

  it('空字符串不算便携版（变量存在但没有值）', async () => {
    const { isPortableBuild } = await import('../updater')
    process.env[KEY] = ''
    expect(isPortableBuild()).toBe(false)
  })
})