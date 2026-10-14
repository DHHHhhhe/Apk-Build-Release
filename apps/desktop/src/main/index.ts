import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ensureSchema } from './db/client'
import { setupIpcHandlers } from './ipc'
import { killAllRunning } from './services/queue/lib/cancel'
import { recoverStale, tick } from './services/queue/lib/scheduler'
import { logger } from './services/logger'

// 渲染进程只做界面，所有 IO 与进程操作留在主进程（design.md §2）
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f2f2f4',
    // 打包后任务栏图标取自 exe 内嵌的图标（electron-builder 从 build/icon.png 生成）；
    // 开发期 exe 是 Electron 自己的，得显式指一份，否则任务栏显示 Electron 默认图标
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // 外链走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Windows 上系统通知需要 AppUserModelID 才能显示（打包后由安装包设置，开发期显式给一个）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.abr.desktop')
}

void app.whenReady().then(() => {
  ensureSchema()

  // 上次被强杀时留下的 running / pending 项不可能再有人管，收尾成 failed 而不是一直转圈
  const recovered = recoverStale()
  if (recovered > 0) {
    logger.warn('已收尾上次残留的队列项', { count: recovered })
  }

  setupIpcHandlers()
  logger.info('主进程就绪')
  createWindow()
  tick()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 退出时把还在跑的构建收掉，避免留下孤儿 java 进程
app.on('before-quit', () => {
  killAllRunning()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
