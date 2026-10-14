import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// 单测只跑主进程侧的逻辑，不拉真实 Electron：
// 把 electron 与 electron-log 指到 test/stubs 下的桩。
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      'electron-log/main': resolve('test/stubs/electron-log-main.ts'),
      electron: resolve('test/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
